<?php
/**
 * calib_log.php - relay between the production bench and the Apps Script
 * calibration sheet.
 *
 * The bench may run where script.google.com is unreachable, so the browser
 * never talks to Google: it posts here, this server stores the record and
 * forwards it upstream within the same request, so the sheet fills up live.
 *
 * Storage always happens before forwarding. A record that reaches this file is
 * never lost, even if Google is down: it stays in pending/ and is retried by
 * the next bench call, after that call has already been answered. The bench
 * also sends a periodic flush ping, which covers the last robot of a shift.
 *
 * Companion of main.js (CALIB_LOG) and calib_log.gs (API_TOKEN).
 *
 * Endpoints, all POST with Content-Type: text/plain
 *   {"token":"...","record":{...}}  store and forward one calibration
 *   {"token":"...","flush":true}    drain the backlog, no record
 *   {"token":"...","diag":true}     environment report, for debugging
 * A plain GET answers with a liveness probe and no token, so that opening the
 * URL in a browser tells you whether the file is served at all.
 */

declare(strict_types=1);

// ==========================================
// CONFIGURATION
// ==========================================

// Must match CALIB_LOG.token in main.js.
const API_TOKEN = 'API_TOKEN_HERE';

// Apps Script web app /exec URL, and the token it expects (API_TOKEN in
// calib_log.gs). Kept separate from API_TOKEN so the bench-facing secret can be
// rotated without redeploying the Apps Script.
const UPSTREAM_URL     = 'UPSTREAM_URL_HERE';
const UPSTREAM_TOKEN   = 'UPSTREAM_TOKEN_HERE';
const UPSTREAM_TIMEOUT = 10;

// Must sit outside the web root, or be protected by a deny-all .htaccess:
// it holds every calibration ever run.
const DATA_DIR = __DIR__ . '/calib_data';

// Browser origins allowed to post here. Scheme and host only: no path, no
// trailing slash, because that is all the browser sends in the Origin header.
// Add 'http://localhost:5173' while working on the Vite dev server.
const ALLOWED_ORIGINS = ['ALLOWED_ORIGINS_HERE'];

// Rate limit, per client IP, sliding window. A bench cannot calibrate faster
// than a robot at a time, so this is generous by two orders of magnitude and
// still stops anything automated.
const RATE_LIMIT_MAX    = 60;
const RATE_LIMIT_WINDOW = 60;

// Anything larger than this is not a calibration record.
const MAX_BODY_BYTES = 16384;

// How many backlogged records to push upstream after answering the bench.
// Small on purpose: the queue drains over several calls instead of stalling
// one worker on a long replay.
const FLUSH_BATCH = 5;

// Stage log, rotated when it gets past this. Set to 0 to switch it off once
// the bench is known good.
const LOG_MAX_BYTES = 2097152;

// Fixed CSV layout. Adding a key here is enough to give it a column; records
// stored before the change simply leave it empty.
const VALUE_COLUMNS = [
    'mot left', 'mot right',
    'mot forward', 'mot backward',
    'imu scaling', 'imu offsets',
    'color calib',
    'ground black', 'ground white',
];

// ==========================================
// ENTRY POINT
// ==========================================

// The backlog flush runs after the response has been sent, so the bench closing
// the connection must not kill the worker halfway through a forward.
ignore_user_abort(true);

// A fatal error would otherwise reach the caller as an empty body with a 500,
// which says nothing at all. This turns it into something readable, and logs
// it, without ever switching display_errors on in production.
register_shutdown_function(function (): void {
    $error = error_get_last();
    if ($error === null || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }

    relayLog('FATAL', [
        'message' => $error['message'],
        'file'    => basename($error['file']),
        'line'    => $error['line'],
    ]);

    if (PHP_SAPI === 'cli' || headers_sent()) {
        return;
    }

    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok'    => false,
        'error' => 'fatal error',
        'where' => basename($error['file']) . ':' . $error['line'],
        'detail' => $error['message'],
    ]);
});

if (PHP_SAPI === 'cli') {
    // Not required for normal operation: the bench drives the queue on its own.
    // Kept as a way to drain a large backlog by hand after a long outage.
    exit(flushPending(PHP_INT_MAX));
}

handleRequest();

// ==========================================
// HTTP
// ==========================================

function handleRequest(): void
{
    // The bench posts text/plain on purpose: any other content type would
    // trigger a CORS preflight.
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (in_array($origin, ALLOWED_ORIGINS, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    } elseif ($origin !== '') {
        // The response still goes out, but the browser will discard it. Logged
        // because from the bench side this looks like a network failure and
        // nothing else explains it.
        relayLog('origin rejected', ['origin' => $origin]);
    }

    header('Content-Type: application/json; charset=utf-8');

    $method = $_SERVER['REQUEST_METHOD'] ?? '';

    if ($method === 'OPTIONS') {
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        http_response_code(204);
        return;
    }

    // Liveness probe. No token, and it reveals nothing: it exists so that
    // opening the URL in a browser distinguishes "file not served" from
    // "file served but failing".
    if ($method === 'GET') {
        respond(200, [
            'ok'      => true,
            'service' => 'calib_log',
            'php'     => PHP_VERSION,
            'time'    => gmdate('c'),
        ]);
        return;
    }

    if ($method !== 'POST') {
        respond(405, ['ok' => false, 'error' => 'POST only']);
        return;
    }

    // Checked before reading the body: a flood must cost as little as possible.
    if (!allowRequest(clientIp())) {
        relayLog('rate limited', ['ip' => clientIp()]);
        header('Retry-After: ' . RATE_LIMIT_WINDOW);
        respond(429, ['ok' => false, 'error' => 'rate limit exceeded']);
        return;
    }

    $raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);

    relayLog('request', [
        'ip'     => clientIp(),
        'origin' => $origin === '' ? '-' : $origin,
        'bytes'  => strlen($raw),
    ]);

    if (strlen($raw) > MAX_BODY_BYTES) {
        relayLog('rejected', ['reason' => 'body too large']);
        respond(413, ['ok' => false, 'error' => 'body too large']);
        return;
    }

    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        relayLog('rejected', ['reason' => 'malformed JSON', 'head' => substr($raw, 0, 120)]);
        respond(400, ['ok' => false, 'error' => 'malformed JSON']);
        return;
    }

    if (!hash_equals(API_TOKEN, (string) ($payload['token'] ?? ''))) {
        relayLog('rejected', ['reason' => 'bad token']);
        respond(403, ['ok' => false, 'error' => 'bad token']);
        return;
    }

    if (!empty($payload['diag'])) {
        respond(200, ['ok' => true, 'diag' => diagnostics()]);
        return;
    }

    // Heartbeat from the bench: no record, just an occasion to drain the queue.
    // This is what covers the last robot of a shift, the one with no successor
    // to carry its record upstream.
    if (!empty($payload['flush'])) {
        $pending = count(glob(dataPath('pending') . '/*.json') ?: []);
        relayLog('flush ping', ['pending' => $pending]);
        respond(200, ['ok' => true, 'flush' => true, 'pending' => $pending]);
        closeConnection();
        flushPending(FLUSH_BATCH);
        return;
    }

    $record = $payload['record'] ?? null;
    if (!is_array($record) || ($record['robot'] ?? '') === '') {
        relayLog('rejected', ['reason' => 'missing record.robot']);
        respond(400, ['ok' => false, 'error' => 'missing record.robot']);
        return;
    }

    // Stamped server side, so that a bench with a wrong clock or no NTP cannot
    // poison the ordering of the sheet.
    $record['received_at'] = gmdate('c');

    $fingerprint = fingerprint($record);

    relayLog('record in', [
        'robot'  => (string) $record['robot'],
        'run_id' => (string) ($record['run_id'] ?? '-'),
        'fp'     => substr($fingerprint, 0, 12),
    ]);

    // A retry of a record already held. Report where it actually stands rather
    // than a flat success, so a bench retrying a record still stuck in the
    // queue is not told the sheet has it.
    if (alreadySeen($fingerprint)) {
        $sent = file_exists(dataPath('sent', $fingerprint));
        relayLog('duplicate', ['fp' => substr($fingerprint, 0, 12), 'sent' => $sent]);
        respond(200, ['ok' => true, 'duplicate' => true, 'forwarded' => $sent]);
        return;
    }

    if (!storeRecord($fingerprint, $record)) {
        // Nothing was persisted, so the bench must know: this is the only case
        // where the operator has to act on the spot.
        relayLog('store FAILED', ['dir' => dataPath('pending')]);
        respond(500, ['ok' => false, 'error' => 'could not store record']);
        return;
    }

    relayLog('stored', ['fp' => substr($fingerprint, 0, 12)]);

    appendCsv($record);

    // Synchronous on purpose: this is what makes the sheet fill up while the
    // operator is still looking at the bench. A failure here is not fatal, the
    // record is already safe and will go up with a later call.
    $forwarded = forward($fingerprint, $record);

    respond(200, ['ok' => true, 'stored' => true, 'forwarded' => $forwarded]);

    // From here on the bench is no longer waiting.
    closeConnection();

    if ($forwarded) {
        flushPending(FLUSH_BATCH);
    }
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
}

/**
 * Hands the response back to the client and keeps the worker running. Under
 * PHP-FPM this is exact; elsewhere the buffers are flushed and the backlog work
 * simply happens with the connection still open, which is harmless because the
 * bench has its own timeout.
 */
function closeConnection(): void
{
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        return;
    }

    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
}

// ==========================================
// DIAGNOSTICS
// ==========================================

/**
 * Everything that has to be true for this relay to work, checked for real
 * rather than assumed. Token protected, and it returns no secret: the upstream
 * URL is reported only as its deployment id prefix.
 */
function diagnostics(): array
{
    $report = [
        'php_version'      => PHP_VERSION,
        'sapi'             => PHP_SAPI,
        'fastcgi_finish'   => function_exists('fastcgi_finish_request'),
        'curl_available'   => function_exists('curl_init'),
        'data_dir'         => DATA_DIR,
        'data_dir_exists'  => is_dir(DATA_DIR),
        'data_dir_writable' => false,
        'pending'          => 0,
        'sent'             => 0,
        'rejected'         => 0,
        'upstream_host'    => (string) parse_url(UPSTREAM_URL, PHP_URL_HOST),
        'upstream_configured' => strpos(UPSTREAM_URL, 'PASTE_YOUR_EXEC_ID') === false,
    ];

    // Written and removed for real: is_writable lies on some shared hosting
    // setups where the mount is read only but the permission bits are not.
    $probe = DATA_DIR . '/.write_probe';
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }
    if (@file_put_contents($probe, 'probe') !== false) {
        $report['data_dir_writable'] = true;
        @unlink($probe);
    }

    $report['data_dir_exists'] = is_dir(DATA_DIR);
    $report['pending']  = count(glob(dataPath('pending') . '/*.json') ?: []);
    $report['sent']     = count(glob(dataPath('sent') . '/*.json') ?: []);
    $report['rejected'] = count(glob(dataPath('rejected') . '/*.json') ?: []);

    if (!$report['curl_available']) {
        $report['upstream'] = ['error' => 'curl extension missing'];
        return $report;
    }

    // A GET against the deployment. calib_log.gs answers doGet with a small
    // JSON, so anything else here is a deployment problem, not a relay one.
    $ch = curl_init(UPSTREAM_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => UPSTREAM_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);

    $body  = curl_exec($ch);
    $info  = curl_getinfo($ch);
    $error = curl_error($ch);
    curl_close($ch);

    $report['upstream'] = [
        'http_code'    => $info['http_code'] ?? 0,
        'total_time_s' => round((float) ($info['total_time'] ?? 0), 2),
        'curl_error'   => $error === '' ? null : $error,
        // Truncated: an Apps Script error answers with a full HTML page.
        'body_head'    => $body === false ? null : substr((string) $body, 0, 200),
    ];

    return $report;
}

/**
 * Append only stage log. This is the file to read when the bench says the
 * upload failed and nothing else explains why.
 */
function relayLog(string $stage, array $context = []): void
{
    if (LOG_MAX_BYTES <= 0) {
        return;
    }

    $path = DATA_DIR . '/relay.log';

    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }

    // Rotated rather than trimmed: keeping one previous file is enough to cover
    // the window between a failure and somebody looking at it.
    if (file_exists($path) && filesize($path) > LOG_MAX_BYTES) {
        @rename($path, $path . '.1');
    }

    $parts = [];
    foreach ($context as $key => $value) {
        if (is_bool($value)) {
            $value = $value ? 'true' : 'false';
        }
        $parts[] = $key . '=' . str_replace("\n", ' ', (string) $value);
    }

    $line = gmdate('Y-m-d H:i:s') . ' | ' . $stage;
    if ($parts !== []) {
        $line .= ' | ' . implode(' ', $parts);
    }

    @file_put_contents($path, $line . "\n", FILE_APPEND | LOCK_EX);
}

// ==========================================
// RATE LIMIT
// ==========================================

function clientIp(): string
{
    // Only trust a proxy header if the hosting actually sits behind one;
    // otherwise it is attacker controlled and defeats the whole limiter.
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

/**
 * Sliding window counter, one small file per client. Uses an exclusive lock so
 * that two concurrent requests cannot both read the same stale count.
 */
function allowRequest(string $ip): bool
{
    $path = dataPath('rate') . '/' . sha1($ip) . '.txt';

    $handle = @fopen($path, 'c+');
    if ($handle === false) {
        // Never lock the bench out because of a storage problem.
        return true;
    }

    flock($handle, LOCK_EX);

    $now    = time();
    $cutoff = $now - RATE_LIMIT_WINDOW;
    $raw    = (string) stream_get_contents($handle);

    $stamps = array_values(array_filter(
        array_map('intval', preg_split('/\s+/', $raw, -1, PREG_SPLIT_NO_EMPTY) ?: []),
        static fn(int $stamp): bool => $stamp > $cutoff
    ));

    $allowed = count($stamps) < RATE_LIMIT_MAX;
    if ($allowed) {
        $stamps[] = $now;
    }

    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, implode("\n", $stamps));

    flock($handle, LOCK_UN);
    fclose($handle);

    return $allowed;
}

// ==========================================
// STORAGE
// ==========================================

/**
 * Identity of a record, used as a filename, which gives deduplication for free
 * without any index to keep consistent.
 *
 * It is the run_id minted by the bench, never a hash of the values: two
 * calibrations of the same robot may legitimately produce identical numbers and
 * must still land as two rows. The bench repeats the same run_id across its own
 * retries, so those still collapse into one.
 *
 * Hashed rather than used raw: the result becomes a path, and a client supplied
 * string never gets to decide where this process writes.
 */
function fingerprint(array $record): string
{
    $runId = (string) ($record['run_id'] ?? '');

    if ($runId !== '') {
        return sha1('run:' . $runId);
    }

    // Older bench without run_id: fall back to the content, which at least
    // keeps retries idempotent.
    $values = $record['values'] ?? [];
    if (is_array($values)) {
        ksort($values);
    }

    return sha1((string) json_encode([
        $record['robot'] ?? '',
        $record['result'] ?? '',
        $record['fw_version'] ?? '',
        $values,
    ]));
}

function dataPath(string $subdir, string $fingerprint = ''): string
{
    $path = DATA_DIR . '/' . $subdir;
    if (!is_dir($path)) {
        @mkdir($path, 0750, true);
    }

    return $fingerprint === '' ? $path : $path . '/' . $fingerprint . '.json';
}

function alreadySeen(string $fingerprint): bool
{
    return file_exists(dataPath('pending', $fingerprint))
        || file_exists(dataPath('sent', $fingerprint));
}

function storeRecord(string $fingerprint, array $record): bool
{
    $target = dataPath('pending', $fingerprint);
    $tmp    = $target . '.tmp';

    // Write then rename: a crash mid-write leaves a .tmp behind rather than a
    // truncated record a later call would try to forward.
    if (@file_put_contents($tmp, json_encode($record, JSON_PRETTY_PRINT)) === false) {
        return false;
    }

    return @rename($tmp, $target);
}

/**
 * Human readable mirror, one file per month. This is what gets opened when the
 * sheet is unreachable and somebody needs the numbers now.
 */
function appendCsv(array $record): void
{
    $path   = DATA_DIR . '/calibrations-' . gmdate('Y-m') . '.csv';
    $isNew  = !file_exists($path);
    $values = $record['values'] ?? [];

    $handle = @fopen($path, 'a');
    if ($handle === false) {
        relayLog('csv FAILED', ['path' => $path]);
        return;
    }

    flock($handle, LOCK_EX);

    if ($isNew) {
        fputcsv($handle, array_merge(
            ['timestamp', 'run_id', 'robot', 'result', 'fw_version', 'battery_mv'],
            VALUE_COLUMNS
        ));
    }

    $row = [
        // Same field the sheet puts in its timestamp column: the moment the
        // record was taken, which is the moment the robot was calibrated.
        $record['received_at'] ?? '',
        $record['run_id'] ?? '',
        $record['robot'] ?? '',
        $record['result'] ?? '',
        $record['fw_version'] ?? '',
        $record['battery_mv'] ?? '',
    ];

    foreach (VALUE_COLUMNS as $key) {
        $row[] = is_array($values) ? ($values[$key] ?? '') : '';
    }

    fputcsv($handle, $row);
    flock($handle, LOCK_UN);
    fclose($handle);
}

// ==========================================
// UPSTREAM
// ==========================================

/**
 * Posts one record to Apps Script and, on success, moves it out of pending.
 * FOLLOWLOCATION is mandatory: an /exec URL answers with a redirect to
 * script.googleusercontent.com, and without it every upload looks like a 302.
 */
function forward(string $fingerprint, array $record): bool
{
    if (!function_exists('curl_init')) {
        relayLog('forward FAILED', ['reason' => 'curl extension missing']);
        return false;
    }

    $ch = curl_init(UPSTREAM_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'token'  => UPSTREAM_TOKEN,
            'record' => $record,
        ]),
        CURLOPT_HTTPHEADER     => ['Content-Type: text/plain;charset=utf-8'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => UPSTREAM_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);

    $body   = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error  = curl_error($ch);
    curl_close($ch);

    if ($body === false || $status !== 200) {
        relayLog('forward FAILED', [
            'fp'     => substr($fingerprint, 0, 12),
            'status' => $status,
            'curl'   => $error === '' ? '-' : $error,
        ]);
        return false;
    }

    $answer = json_decode((string) $body, true);
    if (!is_array($answer) || empty($answer['ok'])) {
        // A rejected record will be rejected again on every retry, so it is
        // parked instead of being replayed forever: it needs a human.
        relayLog('forward REJECTED', [
            'fp'   => substr($fingerprint, 0, 12),
            'head' => substr((string) $body, 0, 160),
        ]);
        @rename(dataPath('pending', $fingerprint), dataPath('rejected', $fingerprint));
        return false;
    }

    relayLog('forwarded', [
        'fp'        => substr($fingerprint, 0, 12),
        'duplicate' => !empty($answer['duplicate']),
    ]);

    @rename(dataPath('pending', $fingerprint), dataPath('sent', $fingerprint));
    return true;
}

/**
 * Pushes up to $limit backlogged records upstream. Called after the response
 * has been sent, so the operator never waits for a replay; oldest first, so a
 * long outage lands in the sheet in the order it happened.
 */
function flushPending(int $limit): int
{
    $files = glob(dataPath('pending') . '/*.json') ?: [];
    if ($files === []) {
        return 0;
    }

    usort($files, static fn(string $a, string $b): int => filemtime($a) <=> filemtime($b));

    $sent = 0;
    foreach (array_slice($files, 0, $limit) as $file) {
        $record = json_decode((string) file_get_contents($file), true);
        if (!is_array($record)) {
            continue;
        }

        if (!forward(basename($file, '.json'), $record)) {
            // Upstream is down again: stop rather than burn the batch on it.
            break;
        }

        $sent++;
    }

    relayLog('flush done', ['sent' => $sent, 'pending' => count($files)]);

    if (PHP_SAPI === 'cli') {
        echo gmdate('c') . " flushed $sent of " . count($files) . " pending record(s)\n";
    }

    return 0;
}
