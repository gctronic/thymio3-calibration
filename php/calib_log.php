<?php
/**
 * calib_log.php - relay between the production bench and the Apps Script
 * calibration sheet.
 *
 * The bench may run where script.google.com is unreachable, so the browser
 * never talks to Google: it posts here, this file writes the record to a local
 * CSV, answers immediately, and only then forwards it upstream.
 *
 * There is no queue and no backlog. The CSV is the relay's copy of record; if
 * the forward fails after its retries, the row is missing from the sheet and
 * has to be recovered from the CSV by hand. This is deliberate: a queue nobody
 * drains is worse than no queue at all.
 *
 * Companion of main.js (CALIB_LOG) and calib_log.gs (API_TOKEN).
 *
 * Endpoints, all POST with Content-Type: text/plain
 *   {"token":"...","record":{...}}  store and forward one calibration
 *   {"token":"...","diag":true}     environment report, for debugging
 * A plain GET answers with a liveness probe and no token, so that opening the
 * URL in a browser tells you whether the file is served at all.
 *
 * Requires PHP 8.0 or later.
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
const UPSTREAM_URL   = 'UPSTREAM_URL_HERE';
const UPSTREAM_TOKEN = 'UPSTREAM_TOKEN_HERE';

// Per-attempt budget. Must stay LONGER than waitLock() in calib_log.gs plus the
// round trip, otherwise Apps Script keeps working on a call this side has
// abandoned and writes a row nobody is told about.
//
// The round trip alone is around 3 s: /exec redirects to
// script.googleusercontent.com, so every attempt pays two TLS handshakes on top
// of the script's own work. That is measured, not assumed - the diag endpoint
// reports it as upstream.total_time_s. waitLock is set to 10 s against the 15 s
// here, which leaves the margin that round trip needs.
const UPSTREAM_TIMEOUT         = 15;
const UPSTREAM_CONNECT_TIMEOUT = 5;

// Forward attempts, first try included, and the pause between them.
//
// This host runs PHP-FPM, so closeConnection() really does detach the worker:
// measured end to end, the bench gets its answer in under 0.2 s while the
// forward carries on here. The budget below is therefore invisible to the
// operator and can afford to be generous - which is what makes a contended
// Apps Script lock recoverable instead of fatal.
//
// Worst case 2 * 15 + 1 * 2 = 32 s of worker time, inside the 60 s granted by
// set_time_limit() in handleRequest(). If the SAPI ever changes and the answer
// starts arriving only at the end of the request, this becomes the bench's wait
// as well and CALIB_LOG.timeoutMs in main.js has to cover it:
//
//   CALIB_LOG.timeoutMs
//     > UPSTREAM_ATTEMPTS * UPSTREAM_TIMEOUT
//       + (UPSTREAM_ATTEMPTS - 1) * UPSTREAM_RETRY_DELAY
const UPSTREAM_ATTEMPTS    = 2;
const UPSTREAM_RETRY_DELAY = 2;

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

// The forward runs after the response has been sent, so the bench closing the
// connection must not kill the worker halfway through it.
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
        'ok'     => false,
        'error'  => 'fatal error',
        'where'  => basename($error['file']) . ':' . $error['line'],
        'detail' => $error['message'],
    ]);
});

handleRequest();

// ==========================================
// HTTP
// ==========================================

function handleRequest(): void
{
    disableOutputBuffering();

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

    $record = $payload['record'] ?? null;
    if (!is_array($record) || ($record['robot'] ?? '') === '') {
        relayLog('rejected', ['reason' => 'missing record.robot']);
        respond(400, ['ok' => false, 'error' => 'missing record.robot']);
        return;
    }

    // Stamped server side, so that a bench with a wrong clock or no NTP cannot
    // poison the ordering of the sheet.
    $record['received_at'] = gmdate('c');

    $runId = (string) ($record['run_id'] ?? '');

    relayLog('record in', [
        'robot'  => (string) $record['robot'],
        'run_id' => $runId === '' ? '-' : $runId,
    ]);

    // The CSV is the relay's own copy, so it has to succeed before anything is
    // promised to the bench. This is the only failure the operator must act on.
    if (!appendCsv($record)) {
        respond(500, ['ok' => false, 'error' => 'could not write CSV']);
        return;
    }

    // Answered here, not after the forward: the record is already safe, and
    // Apps Script latency (cold start plus a script lock) is unbounded and far
    // beyond the bench's own abort.
    respond(200, ['ok' => true, 'stored' => true]);
    closeConnection();

    // The bench is no longer waiting, so the retries below cost it nothing.
    // The limit is raised because the default one would kill the worker
    // mid-retry on a slow upstream.
    @set_time_limit(60);
    forward($record);
}

function respond(int $status, array $body): void
{
    $json = (string) json_encode($body);

    http_response_code($status);
    // Content-Length lets the client finish reading the body before the worker
    // exits: without it, a fetch() waits for the connection to close, which on
    // a non-FPM host means waiting for the post-response forward as well.
    header('Content-Length: ' . strlen($json));
    echo $json;
}

/**
 * Turns off everything between this script and the socket that would hold the
 * response back. A compressing output filter replaces our Content-Length with
 * chunked encoding, and the client then cannot tell the body has ended until
 * the worker exits - which is exactly what the post-response forward delays.
 */
function disableOutputBuffering(): void
{
    if (function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', '1');
        @apache_setenv('dont-vary', '1');
    }

    @ini_set('zlib.output_compression', '0');
    @ini_set('implicit_flush', '1');
}

/**
 * Hands the response back to the client and keeps the worker running.
 */
function closeConnection(): void
{
    // PHP-FPM.
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        return;
    }

    // LiteSpeed, which is what a lot of shared hosting actually runs. Same
    // semantics, different name.
    if (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
        return;
    }

    // mod_php and plain CGI: the connection cannot be closed from here. The
    // bytes are pushed out and Content-Length is what lets the client stop
    // reading; if it still waits, nothing in this file can fix it and the bench
    // timeout has to cover the whole request instead.
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
}

// ==========================================
// STORAGE
// ==========================================

/**
 * Appends one record to the month's CSV, which is the relay's only copy. This
 * is also what gets opened when the sheet is unreachable and somebody needs the
 * numbers now.
 *
 * A record whose run_id is already in the file is skipped: the bench repeats
 * the same run_id across its retries, so a lost response must not produce a
 * second line. Scanning the file is cheap enough at one calibration per robot,
 * and it keeps the relay free of any state directory to maintain.
 */
function appendCsv(array $record): bool
{
    $path  = DATA_DIR . '/calibrations-' . gmdate('Y-m') . '.csv';
    $runId = (string) ($record['run_id'] ?? '');

    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }

    $handle = @fopen($path, 'c+');
    if ($handle === false) {
        relayLog('csv FAILED', ['path' => $path]);
        return false;
    }

    flock($handle, LOCK_EX);

    $existing = (string) stream_get_contents($handle);

    if ($runId !== '' && str_contains($existing, $runId)) {
        flock($handle, LOCK_UN);
        fclose($handle);
        relayLog('csv duplicate', ['run_id' => $runId]);
        // Not an error: the record is in the file, which is all the bench asked
        // for. The caller still forwards, on purpose: a retry means the first
        // response never arrived, so that worker may well have died before
        // reaching the sheet. A second forward is free, the sheet deduplicates
        // on run_id.
        return true;
    }

    if ($existing === '') {
        // escape: '' turns off the backslash escaping nobody expects in a CSV,
        // which mangles any value holding one and is deprecated from PHP 8.4.
        fputcsv($handle, array_merge(
            ['timestamp', 'run_id', 'robot', 'result', 'fw_version', 'battery_mv'],
            VALUE_COLUMNS
        ), ',', '"', '');
    }

    $values = $record['values'] ?? [];
    $row    = [
        // Same field the sheet puts in its timestamp column: the moment the
        // record was taken, which is the moment the robot was calibrated.
        $record['received_at'] ?? '',
        $runId,
        $record['robot'] ?? '',
        $record['result'] ?? '',
        $record['fw_version'] ?? '',
        $record['battery_mv'] ?? '',
    ];

    foreach (VALUE_COLUMNS as $key) {
        $row[] = is_array($values) ? ($values[$key] ?? '') : '';
    }

    fseek($handle, 0, SEEK_END);
    fputcsv($handle, $row, ',', '"', '');

    flock($handle, LOCK_UN);
    fclose($handle);

    relayLog('csv stored', ['run_id' => $runId === '' ? '-' : $runId]);

    return true;
}

// ==========================================
// UPSTREAM
// ==========================================

/**
 * Posts one record to Apps Script, retrying a fixed number of times.
 *
 * FOLLOWLOCATION is mandatory: an /exec URL answers with a redirect to
 * script.googleusercontent.com, and without it every upload looks like a 302.
 *
 * A retry cannot duplicate the row: calib_log.gs keys its own deduplication on
 * run_id, so a call that wrote the row but lost its response comes back as
 * {ok:true, duplicate:true} on the next attempt.
 */
function forward(array $record): bool
{
    if (!function_exists('curl_init')) {
        relayLog('forward FAILED', ['reason' => 'curl extension missing']);
        return false;
    }

    try {
        // Without JSON_THROW_ON_ERROR a record carrying, say, invalid UTF-8
        // would encode to false and be posted as an empty body, which upstream
        // reports as 'empty body' three times over.
        $body = json_encode(
            ['token' => UPSTREAM_TOKEN, 'record' => $record],
            JSON_THROW_ON_ERROR
        );
    } catch (JsonException $e) {
        relayLog('forward FAILED', ['reason' => 'record not encodable: ' . $e->getMessage()]);
        return false;
    }

    for ($attempt = 1; $attempt <= UPSTREAM_ATTEMPTS; $attempt++) {
        $ch = curl_init(UPSTREAM_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => ['Content-Type: text/plain;charset=utf-8'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => UPSTREAM_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => UPSTREAM_CONNECT_TIMEOUT,
        ]);

        $response = curl_exec($ch);
        $status   = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error    = curl_error($ch);

        $answer = is_string($response) ? json_decode($response, true) : null;

        if ($status === 200 && is_array($answer) && !empty($answer['ok'])) {
            relayLog('forwarded', [
                'attempt'   => $attempt,
                'row'       => $answer['row'] ?? '-',
                'duplicate' => !empty($answer['duplicate']),
            ]);
            return true;
        }

        relayLog('forward failed', [
            'attempt' => $attempt,
            'status'  => $status,
            'curl'    => $error === '' ? '-' : $error,
            'head'    => is_string($response) ? substr($response, 0, 120) : '-',
        ]);

        if ($attempt < UPSTREAM_ATTEMPTS) {
            sleep(UPSTREAM_RETRY_DELAY);
        }
    }

    // Out of attempts. The row is missing from the sheet and only the CSV has
    // it; nobody is watching this, so the log line is the only trace.
    relayLog('forward GIVEN UP', ['run_id' => (string) ($record['run_id'] ?? '-')]);

    return false;
}

// ==========================================
// DIAGNOSTICS
// ==========================================

/**
 * Everything that has to be true for this relay to work, checked for real
 * rather than assumed. Token protected, and it returns no secret: the upstream
 * URL is reported only as its host.
 */
function diagnostics(): array
{
    $report = [
        'php_version'       => PHP_VERSION,
        'sapi'              => PHP_SAPI,
        'fastcgi_finish'    => function_exists('fastcgi_finish_request'),
        'litespeed_finish'  => function_exists('litespeed_finish_request'),
        // If both finish functions are false, the bench waits for the whole
        // request; if zlib is on, it waits even then, because Content-Length
        // does not survive the compressing filter.
        'zlib_compression'  => (string) ini_get('zlib.output_compression'),
        'curl_available'    => function_exists('curl_init'),
        'data_dir'          => DATA_DIR,
        'data_dir_writable' => false,
        'csv_bytes'         => 0,
        'upstream_host'     => (string) parse_url(UPSTREAM_URL, PHP_URL_HOST),
    ];

    // Written and removed for real: is_writable lies on some shared hosting
    // setups where the mount is read only but the permission bits are not.
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }

    $probe = DATA_DIR . '/.write_probe';
    if (@file_put_contents($probe, 'probe') !== false) {
        $report['data_dir_writable'] = true;
        @unlink($probe);
    }

    $csv = DATA_DIR . '/calibrations-' . gmdate('Y-m') . '.csv';
    $report['csv_bytes'] = file_exists($csv) ? (int) filesize($csv) : 0;

    if (!$report['curl_available']) {
        $report['upstream'] = ['error' => 'curl extension missing'];
        return $report;
    }

    // A GET against the deployment. calib_log.gs answers doGet with a small
    // JSON, so anything else here is a deployment problem, not a relay one.
    // total_time_s is the number to watch: it is the floor of every forward.
    $ch = curl_init(UPSTREAM_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => UPSTREAM_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => UPSTREAM_CONNECT_TIMEOUT,
    ]);

    $body  = curl_exec($ch);
    $info  = curl_getinfo($ch);
    $error = curl_error($ch);

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
 * Append only stage log. This is the file to read when a row is missing from
 * the sheet: 'forward GIVEN UP' names the run_id to recover from the CSV.
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
    $dir = DATA_DIR . '/rate';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }

    $handle = @fopen($dir . '/' . sha1($ip) . '.txt', 'c+');
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
