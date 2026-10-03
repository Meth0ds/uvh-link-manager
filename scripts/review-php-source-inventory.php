<?php

// Read source as tokens; do not bootstrap Laravel or execute application code.
$root = dirname(__DIR__).'/backend-laravel';
$files = [];
foreach (['app', 'bootstrap', 'config', 'routes'] as $directory) {
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root.'/'.$directory, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->getExtension() !== 'php' || str_contains($file->getPathname(), '/bootstrap/cache/')) {
            continue;
        }
        $source = file_get_contents($file->getPathname());
        $raw = token_get_all($source, TOKEN_PARSE);
        $tokens = [];
        $line = 1;
        foreach ($raw as $token) {
            $tokens[] = ['id' => is_array($token) ? $token[0] : null, 'text' => is_array($token) ? $token[1] : $token, 'line' => $line];
            $line += substr_count(is_array($token) ? $token[1] : $token, "\n");
        }
        $functions = [];
        foreach ($tokens as $index => $token) {
            if (! in_array($token['id'], [T_FUNCTION, T_FN], true)) {
                continue;
            }
            $name = null;
            if ($token['id'] === T_FUNCTION) {
                for ($next = $index + 1; $next < count($tokens); $next++) {
                    if ($tokens[$next]['text'] === '(') {
                        break;
                    }
                    if ($tokens[$next]['id'] === T_STRING) {
                        $name = $tokens[$next]['text'];
                        break;
                    }
                }
            }
            $end = $token['line'];
            $kind = $token['id'] === T_FN ? 'arrow' : ($name === null ? 'closure' : 'named');
            if ($token['id'] === T_FUNCTION) {
                for ($next = $index + 1; $next < count($tokens); $next++) {
                    if ($tokens[$next]['text'] === ';') {
                        $kind = 'signature';
                        break;
                    }
                    if ($tokens[$next]['text'] !== '{') {
                        continue;
                    }
                    $depth = 1;
                    for ($cursor = $next + 1; $cursor < count($tokens); $cursor++) {
                        // Curly interpolation opens a token but closes with a literal }.
                        if ($tokens[$cursor]['text'] === '{' || in_array($tokens[$cursor]['id'], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true)) {
                            $depth++;
                        } elseif ($tokens[$cursor]['text'] === '}') {
                            $depth--;
                            if ($depth === 0) {
                                $end = $tokens[$cursor]['line'];
                                break;
                            }
                        }
                    }
                    break;
                }
            }
            $functions[] = ['name' => $name, 'kind' => $kind, 'line' => $token['line'], 'endLine' => $end];
        }
        foreach ($functions as &$function) {
            if ($function['name'] !== null) {
                continue;
            }
            $owner = null;
            foreach ($functions as $candidate) {
                if ($candidate['name'] !== null && $candidate['line'] <= $function['line'] && $candidate['endLine'] >= $function['line']) {
                    if ($owner === null || $candidate['line'] > $owner['line']) {
                        $owner = $candidate;
                    }
                }
            }
            $function['ownerFunction'] = $owner['name'] ?? null;
        }
        unset($function);
        $files[] = ['path' => 'backend-laravel/'.substr($file->getPathname(), strlen($root) + 1), 'sha256' => hash('sha256', $source), 'language' => 'php', 'functions' => $functions];
    }
}
usort($files, fn ($left, $right) => strcmp($left['path'], $right['path']));
echo json_encode($files, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
