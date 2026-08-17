<?php
// Writes the sectioned targets.cfg. /update.php only handles flat .cfg files,
// so this endpoint exists.
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

$targetsPath = '/boot/config/plugins/dockhook/targets.cfg';
$rcScript    = '/etc/rc.d/rc.dockhook';

function fail(string $message): void {
  exit(json_encode(['ok' => false, 'error' => $message]));
}

// The allowlist regex below permits dot-only strings like "." or ".." since
// every character is individually within the allowed class. Reject those
// explicitly to match the TypeScript side's isSafeName() guard.
function isDotOnly(string $s): bool {
  return preg_match('/^\.+$/', $s) === 1;
}

// Parallel arrays from the repeating form rows.
$names    = $_POST['target_name'] ?? [];
$kinds    = $_POST['target_kind'] ?? [];
$values   = $_POST['target_value'] ?? [];
$timeouts = $_POST['target_timeout'] ?? [];

if (!is_array($names) || !is_array($kinds) || !is_array($values) || !is_array($timeouts)) {
  fail('Malformed submission.');
}

$safe = '/^[A-Za-z0-9._-]+$/';
// Same bounds as the TypeScript side's ACTION_TIMEOUT_MS / per-target TIMEOUT_MS.
$timeoutMin = 1000;
$timeoutMax = 24 * 60 * 60 * 1000;
$seen = [];
$out  = "# Target mappings, managed from Settings -> Dockhook\n";

foreach ($names as $i => $name) {
  $name    = trim($name);
  $kind    = trim($kinds[$i] ?? '');
  $value   = trim($values[$i] ?? '');
  $timeout = trim($timeouts[$i] ?? '');

  if ($name === '' && $value === '') continue;

  if (!preg_match($safe, $name)) {
    fail("Target name \"$name\" may only contain letters, digits, dot, dash and underscore.");
  }
  if (isDotOnly($name)) {
    fail("Target name \"$name\" may not be only dots.");
  }
  if (isset($seen[$name])) {
    fail("Target \"$name\" is listed twice.");
  }
  if (!in_array($kind, ['container', 'script'], true)) {
    fail("Target \"$name\": kind must be container or script.");
  }
  if (!preg_match($safe, $value)) {
    fail("Target \"$name\": the container name or script id is missing or invalid.");
  }
  if (isDotOnly($value)) {
    fail("Target \"$name\": the container name or script id may not be only dots.");
  }
  if ($timeout !== '' && (!preg_match('/^\d+$/', $timeout) || (int)$timeout < $timeoutMin || (int)$timeout > $timeoutMax)) {
    fail("Target \"$name\": timeout override must be a whole number between $timeoutMin and $timeoutMax.");
  }
  $seen[$name] = true;

  $key  = $kind === 'container' ? 'NAME' : 'ID';
  $out .= "\n[$name]\nKIND=\"$kind\"\n$key=\"$value\"\n";
  if ($timeout !== '') {
    $out .= "TIMEOUT_MS=\"$timeout\"\n";
  }
}

// Atomic write so a crash cannot leave a half-written file on the flash drive.
$tmp = $targetsPath . '.tmp';
if (file_put_contents($tmp, $out) === false || !rename($tmp, $targetsPath)) {
  fail('Could not write targets.cfg.');
}
chmod($targetsPath, 0600);

exec("$rcScript restart 2>&1", $output, $code);
echo json_encode(['ok' => true, 'detail' => implode("\n", $output)]);
