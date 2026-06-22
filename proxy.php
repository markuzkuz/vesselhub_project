<?php
/**
 * Proxy same-origin per evitar CORS en peticions WMS/WFS (GetCapabilities, etc.)
 */
header('Access-Control-Allow-Origin: *');

$url = $_GET['url'] ?? '';
if (!$url) {
    http_response_code(400);
    exit('Falta el paràmetre url');
}

$parsed = parse_url($url);
if (!$parsed || empty($parsed['scheme']) || empty($parsed['host'])) {
    http_response_code(400);
    exit('URL invàlida');
}

$host = strtolower($parsed['host']);
$serverName = strtolower($_SERVER['SERVER_NAME'] ?? '');

$allowed = in_array($host, ['localhost', '127.0.0.1', 'datahub.utm.csic.es'], true)
    || ($serverName && ($host === $serverName))
    || str_ends_with($host, '.csic.es')
    || str_ends_with($host, '.covam.es');

if (!$allowed) {
    http_response_code(403);
    exit('Host no permès');
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => ['Accept: */*'],
]);

$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

if ($body === false || $status >= 400) {
    http_response_code($status ?: 502);
    exit('Error obtenint el recurs remot');
}

if ($contentType) {
    header('Content-Type: ' . $contentType);
}

echo $body;
