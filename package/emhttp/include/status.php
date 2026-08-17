<?php
// Service status and log tail for the settings page.
//
// The client still sends csrf_token on every request (see dockhook.page).
// We do NOT re-validate it here: on current Unraid releases the webGUI itself
// intercepts every POST to a plugin PHP file under /usr/local/emhttp/plugins/,
// rejects the request outright (empty body, before this script ever runs) if
// csrf_token is missing/wrong/misnamed, and strips the field from $_POST once
// it has verified it — so $_POST['csrf_token'] is never observable here on a
// request that actually reaches this point. A manual re-check against
// $_POST['csrf_token'] would therefore always fail, even for a legitimate
// request. Verified empirically against a live Unraid 7.3.1 install: wrong
// token, missing token, and a differently-named token field are all blocked
// before this script executes; only a correctly-named, valid token lets a
// request through. Unverified on Unraid 6.x — if a future report shows this
// script reachable with a forged/missing csrf_token there, this needs a
// version-aware fallback.

header('Content-Type: application/json');

$rcScript = '/etc/rc.d/rc.dockhook';
$logPath  = '/var/log/dockhook.log';

switch ($_POST['action'] ?? $_GET['action'] ?? '') {
  case 'start':
    exec("$rcScript start 2>&1", $o, $c);
    exit(json_encode(['ok' => $c === 0, 'detail' => implode("\n", $o)]));

  case 'stop':
    exec("$rcScript stop 2>&1", $o, $c);
    exit(json_encode(['ok' => $c === 0, 'detail' => implode("\n", $o)]));

  case 'log':
    if (!file_exists($logPath)) exit(json_encode(['log' => '(no log yet)']));
    exec('tail -n 200 ' . escapeshellarg($logPath) . ' 2>&1', $o);
    exit(json_encode(['log' => implode("\n", $o)]));

  case 'status':
  default:
    exec("$rcScript status 2>&1", $o, $c);
    exit(json_encode(['running' => $c === 0, 'detail' => implode("\n", $o)]));
}
