<?php
$slug = $_GET['bien'] ?? '';

if (!preg_match('/^[a-z0-9-_]+$/i', $slug)) {
  http_response_code(400);
  exit;
}

$dir = __DIR__ . '/../biens/' . $slug . '/documents';

$files = [];

if (is_dir($dir)) {
  foreach (scandir($dir) as $file) {
    if ($file === '.' || $file === '..') continue;
    if (is_file("$dir/$file")) {
      $files[] = [
        "title" => pathinfo($file, PATHINFO_FILENAME),
        "file" => $file
      ];
    }
  }
}

header('Content-Type: application/json');
echo json_encode($files);
