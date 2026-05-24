<?php
// Fichier de vérification – AUCUNE donnée sensible n'est visible dans le code source HTML

$secret = '29/08/09';           // La date secrète avec slashs
$secret_raw = '290809';         // Équivalent sans slash (pour comparaison)

$user_input = $_POST['birthdate'] ?? '';

// Supprime tout caractère non numérique (au cas où)
$user_input = preg_replace('/\D/', '', $user_input);

// On accepte soit 6 chiffres exactement
if (strlen($user_input) !== 6) {
    http_response_code(403);
    die('Format invalide. Utilisez 6 chiffres (ex: 290809).');
}

// Transformation "290809" -> "29/08/09" pour comparer avec $secret
$formatted = substr($user_input, 0, 2) . '/' . substr($user_input, 2, 2) . '/' . substr($user_input, 4, 2);

if ($formatted === $secret || $user_input === $secret_raw) {
    // Chemin absolu du fichier .docx (hors de la racine web)
    $filePath = '/var/www/private/document.docx';
    
    if (!file_exists($filePath)) {
        http_response_code(404);
        die('Fichier introuvable.');
    }
    
    // Envoi du fichier avec les bons headers
    header('Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    header('Content-Disposition: attachment; filename="document.docx"');
    header('Content-Length: ' . filesize($filePath));
    header('Cache-Control: private, no-cache, must-revalidate');
    readfile($filePath);
    exit;
} else {
    http_response_code(403);
    die('Date de naissance incorrecte.');
}