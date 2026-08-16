<?php
// Service status and log tail for the settings page. State-changing actions
// (start/stop) require the CSRF token; reading does too, since Unraid expects
// every plugin endpoint to be token-guarded.

$var = parse_ini_file('/var/local/emhttp/var.ini');
$token = $_POST['csrf_token'] ?? $_GET['csrf_token'] ?? '';
if ($token !== $var['csrf_token']) {
  http_response_code(403);
  exit(json_encode(['error' => 'Security token validation failed']));
}

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
