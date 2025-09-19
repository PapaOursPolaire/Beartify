import javafx.application.Application;
import javafx.embed.swing.SwingFXUtils;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.control.Slider;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.layout.*;
import javafx.scene.media.Media;
import javafx.scene.media.MediaPlayer;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;
import javafx.stage.FileChooser;
import javafx.stage.Stage;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Lyrics extends Application {

    private List<String> lyrics = new ArrayList<>();
    private List<Double> timestamps = new ArrayList<>();
    private VBox lyricsBox;
    private MediaPlayer mediaPlayer;
    private int currentIndex = -1;
    private List<Label> lyricLabels = new ArrayList<>();
    private Label nowPlayingLabel;
    private Button playPauseButton;
    private TextField searchField;
    private Button searchButton;

    public static void main(String[] args) {
        launch(args);
    }

    @Override
    public void start(Stage primaryStage) {
        primaryStage.setTitle("Lecteur de Paroles Avancé");
        
        BorderPane root = new BorderPane();
        root.setTop(createMenuBar(primaryStage));
        
        VBox initBox = new VBox(20);
        initBox.setAlignment(Pos.CENTER);
        initBox.setPadding(new Insets(50));
        Label welcomeLabel = new Label("Bienvenue dans le Lecteur de Paroles");
        welcomeLabel.setFont(Font.font("Arial", FontWeight.BOLD, 24));
        welcomeLabel.setTextFill(Color.DARKBLUE);
        Label instructionLabel = new Label("Ouvrez un fichier audio pour commencer");
        instructionLabel.setFont(Font.font("Arial", 16));
        initBox.getChildren().addAll(welcomeLabel, instructionLabel);
        
        root.setCenter(initBox);
        
        Scene scene = new Scene(root, 900, 600);
        primaryStage.setScene(scene);
        primaryStage.show();
    }

    private MenuBar createMenuBar(Stage primaryStage) {
        MenuBar menuBar = new MenuBar();
        
        Menu fileMenu = new Menu("Fichier");
        MenuItem openAudioItem = new MenuItem("Ouvrir une musique");
        openAudioItem.setOnAction(e -> openAudioFile(primaryStage));
        
        MenuItem openLRCItem = new MenuItem("Ouvrir des paroles (LRC)");
        openLRCItem.setOnAction(e -> openLRCFile(primaryStage));
        openLRCItem.setDisable(true);
        
        MenuItem exitItem = new MenuItem("Quitter");
        exitItem.setOnAction(e -> {
            if (mediaPlayer != null) mediaPlayer.dispose();
            System.exit(0);
        });
        fileMenu.getItems().addAll(openAudioItem, openLRCItem, new SeparatorMenuItem(), exitItem);
        
        Menu helpMenu = new Menu("Aide");
        MenuItem aboutItem = new MenuItem("À propos");
        aboutItem.setOnAction(e -> showAboutDialog());
        helpMenu.getItems().add(aboutItem);
        
        menuBar.getMenus().addAll(fileMenu, helpMenu);
        return menuBar;
    }

    private void openAudioFile(Stage primaryStage) {
        FileChooser fileChooser = new FileChooser();
        fileChooser.setTitle("Ouvrir un fichier audio");
        fileChooser.getExtensionFilters().addAll(
            new FileChooser.ExtensionFilter("Fichiers audio", "*.mp3", "*.wav", "*.m4a", "*.aac"),
            new FileChooser.ExtensionFilter("Tous les fichiers", "*.*")
        );
        
        File audioFile = fileChooser.showOpenDialog(primaryStage);
        if (audioFile == null) return;
        
        try {
            if (mediaPlayer != null) {
                mediaPlayer.stop();
                mediaPlayer.dispose();
            }
            
            Media media = new Media(audioFile.toURI().toString());
            mediaPlayer = new MediaPlayer(media);
            
            MenuBar menuBar = (MenuBar)((BorderPane)primaryStage.getScene().getRoot()).getTop();
            Menu fileMenu = menuBar.getMenus().get(0);
            fileMenu.getItems().get(1).setDisable(false);
            
            String title = extractMetadata(media, "title", audioFile.getName().replaceFirst("\\.\\w+$", ""));
            String artist = extractMetadata(media, "artist", "Artiste inconnu");
            
            // Recherche améliorée des fichiers LRC
            File lrcFile = findLRCFile(audioFile, title, artist);
            if (lrcFile != null && lrcFile.exists()) {
                parseLRC(lrcFile);
            } else {
                lyrics.clear();
                lyrics.add("Aucun fichier de paroles trouvé. Chargez un fichier LRC manuellement.");
                timestamps.clear();
                timestamps.add(0.0);
            }
            
            Image coverImage = loadCoverImage(audioFile, title);
            Color dominantColor = extractDominantColor(coverImage);
            
            createPlayerUI(primaryStage, title, artist, coverImage, dominantColor);
            
            mediaPlayer.currentTimeProperty().addListener((obs, old, now) -> 
                updateLyrics(now.toSeconds()));
            
        } catch (Exception e) {
            showErrorDialog("Erreur lors du chargement du fichier audio: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private String normalizeForComparison(String input) {
        if (input == null || input.trim().isEmpty()) return "";
        
        // Convertir en minuscules
        String normalized = input.toLowerCase();
        
        // Supprimer les accents et diacritiques
        normalized = Normalizer.normalize(normalized, Normalizer.Form.NFD)
                                .replaceAll("\\p{M}", "");
        
        // Supprimer uniquement les caractères les plus problématiques
        normalized = normalized.replaceAll("[^a-z0-9\\s]", "");
        
        // Remplacer les espaces multiples par un seul espace
        normalized = normalized.replaceAll("\\s+", " ").trim();
        
        return normalized;
    }

    private File findLRCFile(File audioFile, String title, String artist) {
        String audioBase = audioFile.getName().replaceFirst("\\.\\w+$", "");
        File parent = audioFile.getParentFile();
        
        // Recherche dans le dossier parent et le dossier Lyrics
        List<File> searchDirs = new ArrayList<>();
        searchDirs.add(parent);
        
        File lyricsDir = findLyricsDirectory(parent);
        if (lyricsDir != null) {
            searchDirs.add(lyricsDir);
        }
        
        // Préparer les versions normalisées pour comparaison
        String normAudioBase = normalizeForComparison(audioBase);
        String normTitle = normalizeForComparison(title);
        String normArtist = normalizeForComparison(artist);
        
        // Recherche dans tous les dossiers pertinents
        for (File dir : searchDirs) {
            File[] lrcFiles = dir.listFiles((d, name) -> name.toLowerCase().endsWith(".lrc"));
            if (lrcFiles == null) continue;
            
            for (File lrcFile : lrcFiles) {
                String lrcName = lrcFile.getName().replaceFirst("\\.lrc$", "");
                String normLrcName = normalizeForComparison(lrcName);
                
                // 1. Correspondance exacte (sans extension)
                if (normLrcName.equals(normAudioBase)) {
                    return lrcFile;
                }
                
                // 2. Correspondance avec préfixe
                if (normLrcName.equals("lyrics" + normAudioBase) || 
                    normLrcName.equals("paroles" + normAudioBase)) {
                    return lrcFile;
                }
                
                // 3. Correspondance avec métadonnées (artiste + titre)
                if (!normArtist.isEmpty() && !normTitle.isEmpty() && 
                    normLrcName.contains(normArtist) && normLrcName.contains(normTitle)) {
                    return lrcFile;
                }
                
                // 4. Correspondance partielle avec titre
                if (!normTitle.isEmpty() && normLrcName.contains(normTitle)) {
                    return lrcFile;
                }
                
                // 5. Correspondance partielle avec artiste
                if (!normArtist.isEmpty() && normLrcName.contains(normArtist)) {
                    return lrcFile;
                }
                
                // 6. Correspondance par mots-clés significatifs
                if (!normTitle.isEmpty() && !normArtist.isEmpty()) {
                    // Extraction des mots-clés significatifs
                    List<String> keywords = extractSignificantKeywords(normTitle + " " + normArtist);
                    
                    boolean allKeywordsMatch = true;
                    for (String keyword : keywords) {
                        if (!normLrcName.contains(keyword)) {
                            allKeywordsMatch = false;
                            break;
                        }
                    }
                    
                    if (allKeywordsMatch && !keywords.isEmpty()) {
                        return lrcFile;
                    }
                }
                
                // 7. Correspondance exacte avec le nom du fichier audio (sans normalisation)
                if (lrcName.equalsIgnoreCase(audioBase)) {
                    return lrcFile;
                }
                
                // 8. Correspondance avec le nom complet du fichier audio (avec extension)
                if (lrcName.equalsIgnoreCase(audioFile.getName())) {
                    return lrcFile;
                }
            }
        }
        
        return null;
    }

    private List<String> extractSignificantKeywords(String text) {
        List<String> keywords = new ArrayList<>();
        String[] words = text.split("\\s+");
        
        // Filtrer les mots trop courts et les mots vides
        for (String word : words) {
            if (word.length() > 3 && !isCommonWord(word)) {
                keywords.add(word);
            }
        }
        
        // Si on n'a pas trouvé de mots significatifs, prendre les 3 premiers mots
        if (keywords.isEmpty() && words.length > 0) {
            int count = Math.min(3, words.length);
            for (int i = 0; i < count; i++) {
                if (words[i].length() > 2) {
                    keywords.add(words[i]);
                }
            }
        }
        
        return keywords;
    }

    private boolean isCommonWord(String word) {
        // Liste de mots communs à ignorer
        String[] commonWords = {"the", "and", "from", "to", "with", "for", "that", "this", "are", "is", "in", "on", "at", "de", "des", "les", "la", "le", "un", "une"};
        for (String common : commonWords) {
            if (common.equals(word)) {
                return true;
            }
        }
        return false;
    }

    private File findLyricsDirectory(File parentDir) {
        String[] possibleNames = {"Lyrics", "lyrics", "LYRICS", "Paroles", "paroles", "Songtexts", "songtexts"};
        for (String name : possibleNames) {
            File dir = new File(parentDir, name);
            if (dir.exists() && dir.isDirectory()) {
                return dir;
            }
        }
        return null;
    }

    private void openLRCFile(Stage primaryStage) {
        if (mediaPlayer == null) {
            showErrorDialog("Veuillez d'abord charger un fichier audio");
            return;
        }
        
        FileChooser fileChooser = new FileChooser();
        fileChooser.setTitle("Ouvrir un fichier LRC");
        fileChooser.getExtensionFilters().add(
            new FileChooser.ExtensionFilter("Fichiers LRC", "*.lrc")
        );
        
        File lrcFile = fileChooser.showOpenDialog(primaryStage);
        if (lrcFile != null) {
            parseLRC(lrcFile);
            refreshLyricsDisplay();
        }
    }

    private String extractMetadata(Media media, String key, String defaultValue) {
        Object value = media.getMetadata().get(key);
        return value != null ? value.toString() : defaultValue;
    }

    private Image loadCoverImage(File audioFile, String title) {
        try {
            File[] possibleLocations = {
                new File(audioFile.getParentFile(), "cover/" + title + ".jpg"),
                new File(audioFile.getParentFile(), title + ".jpg"),
                new File(audioFile.getParentFile(), "cover.jpg"),
                new File(audioFile.getParentFile(), "cover.png"),
                new File(audioFile.getParentFile(), "folder.jpg"),
                new File(audioFile.getParentFile(), "album.jpg"),
                new File(audioFile.getParentFile(), "albumart.jpg")
            };
            
            for (File f : possibleLocations) {
                if (f.exists()) {
                    return new Image(f.toURI().toString());
                }
            }
            
            return createDefaultCover(title);
        } catch (Exception e) {
            return createDefaultCover(title);
        }
    }

    private Image createDefaultCover(String title) {
        BufferedImage bufferedImage = new BufferedImage(300, 300, BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g2d = bufferedImage.createGraphics();
        
        java.awt.Color color1 = new java.awt.Color(30, 30, 70);
        java.awt.Color color2 = new java.awt.Color(70, 30, 30);
        java.awt.GradientPaint gradient = new java.awt.GradientPaint(
            0, 0, color1, 300, 300, color2);
        g2d.setPaint(gradient);
        g2d.fillRect(0, 0, 300, 300);
        
        g2d.setColor(java.awt.Color.WHITE);
        g2d.setFont(new java.awt.Font("Arial", java.awt.Font.BOLD, 100));
        g2d.drawString("♪", 100, 180);
        
        if (title != null && !title.isEmpty()) {
            g2d.setFont(new java.awt.Font("Arial", java.awt.Font.BOLD, 40));
            String shortTitle = title.length() > 10 ? title.substring(0, 10) + "..." : title;
            g2d.drawString(shortTitle, 20, 250);
        }
        
        g2d.dispose();
        return SwingFXUtils.toFXImage(bufferedImage, null);
    }

    private void parseLRC(File lrcFile) {
        lyrics.clear();
        timestamps.clear();
        lyricLabels.clear();
        currentIndex = -1;
        
        Pattern pattern = Pattern.compile("\\[(\\d+):(\\d+)(?:\\.(\\d+))?\\](.*)");
        
        try (BufferedReader reader = new BufferedReader(new FileReader(lrcFile))) {
            String line;
            while ((line = reader.readLine()) != null) {
                Matcher matcher = pattern.matcher(line);
                if (matcher.find()) {
                    int minutes = Integer.parseInt(matcher.group(1));
                    int seconds = Integer.parseInt(matcher.group(2));
                    int millis = matcher.group(3) != null ? 
                        Integer.parseInt(matcher.group(3).substring(0, Math.min(2, matcher.group(3).length()))) * 10 : 0;
                    
                    String lyric = matcher.group(4).trim();
                    double timestamp = minutes * 60 + seconds + millis / 1000.0;
                    
                    timestamps.add(timestamp);
                    lyrics.add(lyric);
                }
            }
        } catch (IOException e) {
            lyrics.add("Erreur de lecture du fichier LRC");
            timestamps.add(0.0);
        }
        
        if (lyrics.isEmpty()) {
            lyrics.add("Format LRC non reconnu ou fichier vide");
            timestamps.add(0.0);
        }
    }

    private void createPlayerUI(Stage primaryStage, String title, String artist, 
                                Image coverImage, Color dominantColor) {
        BorderPane root = (BorderPane) primaryStage.getScene().getRoot();
        
        lyricsBox = new VBox(10);
        lyricsBox.setPadding(new Insets(20));
        lyricsBox.setAlignment(Pos.TOP_CENTER);
        
        Color bgColor = dominantColor.darker().darker();
        lyricsBox.setBackground(new Background(new BackgroundFill(
            bgColor, CornerRadii.EMPTY, Insets.EMPTY)));
        
        refreshLyricsDisplay();
        
        ScrollPane lyricsScroll = new ScrollPane(lyricsBox);
        lyricsScroll.setFitToWidth(true);
        lyricsScroll.setFitToHeight(true);
        
        VBox infoBox = new VBox(20);
        infoBox.setPadding(new Insets(20));
        infoBox.setAlignment(Pos.TOP_CENTER);
        infoBox.setBackground(new Background(new BackgroundFill(
            Color.BLACK, CornerRadii.EMPTY, Insets.EMPTY)));
        
        ImageView coverView = new ImageView(coverImage);
        coverView.setFitWidth(250);
        coverView.setFitHeight(250);
        coverView.setPreserveRatio(true);
        
        nowPlayingLabel = new Label("En écoute:");
        nowPlayingLabel.setTextFill(Color.LIGHTGRAY);
        nowPlayingLabel.setFont(Font.font("Arial", FontWeight.BOLD, 14));
        
        Label titleLabel = new Label(title);
        titleLabel.setTextFill(Color.WHITE);
        titleLabel.setFont(Font.font("Arial", FontWeight.BOLD, 22));
        
        Label artistLabel = new Label(artist);
        artistLabel.setTextFill(Color.LIGHTGRAY);
        artistLabel.setFont(Font.font("Arial", 18));
        
        HBox controls = new HBox(15);
        controls.setAlignment(Pos.CENTER);
        
        playPauseButton = new Button("▶");
        playPauseButton.setStyle("-fx-font-size: 16px; -fx-min-width: 40px;");
        playPauseButton.setOnAction(e -> togglePlayPause());
        
        Button stopButton = new Button("⏹");
        stopButton.setStyle("-fx-font-size: 16px; -fx-min-width: 40px;");
        stopButton.setOnAction(e -> {
            mediaPlayer.stop();
            playPauseButton.setText("▶");
        });
        
        Slider volumeSlider = new Slider(0, 100, 50);
        volumeSlider.valueProperty().addListener((obs, old, now) -> 
        mediaPlayer.setVolume(now.doubleValue() / 100));
        
        // Ajout d'une fonction de recherche manuelle
        HBox searchBox = new HBox(10);
        searchField = new TextField();
        searchField.setPromptText("Rechercher des paroles...");
        searchButton = new Button("Chercher");
        searchButton.setOnAction(e -> searchForLyrics(primaryStage, searchField.getText()));
        searchBox.getChildren().addAll(searchField, searchButton);
        searchBox.setAlignment(Pos.CENTER);
        
        controls.getChildren().addAll(stopButton, playPauseButton, volumeSlider);
        
        infoBox.getChildren().addAll(nowPlayingLabel, coverView, titleLabel, artistLabel, controls, searchBox);
        
        HBox mainContent = new HBox();
        mainContent.getChildren().addAll(lyricsScroll, infoBox);
        HBox.setHgrow(lyricsScroll, Priority.ALWAYS);
        
        root.setCenter(mainContent);
    }

    private void searchForLyrics(Stage primaryStage, String query) {
        if (mediaPlayer == null) {
            showErrorDialog("Veuillez d'abord charger un fichier audio");
            return;
        }
        
        if (query == null || query.trim().isEmpty()) {
            showErrorDialog("Veuillez entrer un terme de recherche");
            return;
        }
        
        File audioFile = null;
        try {
            // Essaye de trouver le fichier audio courant
            String mediaSource = mediaPlayer.getMedia().getSource();
            audioFile = new File(new java.net.URI(mediaSource));
        } catch (Exception e) {
            showErrorDialog("Impossible de trouver le fichier audio");
            return;
        }
        
        File parent = audioFile.getParentFile();
        File lyricsDir = findLyricsDirectory(parent);
        
        FileChooser fileChooser = new FileChooser();
        fileChooser.setTitle("Trouver le fichier LRC");
        if (lyricsDir != null) {
            fileChooser.setInitialDirectory(lyricsDir);
        } else {
            fileChooser.setInitialDirectory(parent);
        }
        
        fileChooser.getExtensionFilters().add(
            new FileChooser.ExtensionFilter("Fichiers LRC", "*.lrc")
        );
        
        File lrcFile = fileChooser.showOpenDialog(primaryStage);
        if (lrcFile != null) {
            parseLRC(lrcFile);
            refreshLyricsDisplay();
        }
    }

    private void refreshLyricsDisplay() {
        lyricsBox.getChildren().clear();
        lyricLabels.clear();
        
        if (lyrics.isEmpty()) {
            Label noLyrics = new Label("Aucune parole disponible");
            noLyrics.setTextFill(Color.LIGHTGRAY);
            noLyrics.setFont(Font.font("Arial", 16));
            lyricsBox.getChildren().add(noLyrics);
            return;
        }
        
        for (String line : lyrics) {
            Label lbl = new Label(line);
            lbl.setTextFill(Color.LIGHTGRAY);
            lbl.setFont(Font.font("Arial", FontWeight.NORMAL, 18));
            lbl.setMaxWidth(Double.MAX_VALUE);
            lbl.setAlignment(Pos.CENTER);
            
            lyricLabels.add(lbl);
            lyricsBox.getChildren().add(lbl);
        }
    }

    private void togglePlayPause() {
        if (mediaPlayer == null) return;
        
        if (mediaPlayer.getStatus() == MediaPlayer.Status.PLAYING) {
            mediaPlayer.pause();
            playPauseButton.setText("▶");
        } else {
            mediaPlayer.play();
            playPauseButton.setText("⏸");
        }
    }

    private void updateLyrics(double currentTime) {
        if (lyricLabels.isEmpty()) return;
        
        int newIndex = -1;
        for (int i = 0; i < timestamps.size(); i++) {
            if (currentTime < timestamps.get(i)) {
                newIndex = i - 1;
                break;
            }
        }
        
        if (newIndex == -1 && !timestamps.isEmpty() && currentTime >= timestamps.get(timestamps.size() - 1)) {
            newIndex = timestamps.size() - 1;
        }
        
        if (newIndex != currentIndex && newIndex >= 0 && newIndex < lyricLabels.size()) {
            if (currentIndex >= 0 && currentIndex < lyricLabels.size()) {
                Label oldLabel = lyricLabels.get(currentIndex);
                oldLabel.setTextFill(Color.LIGHTGRAY);
                oldLabel.setFont(Font.font("Arial", FontWeight.NORMAL, 18));
            }
            
            if (newIndex < lyricLabels.size()) {
                Label currentLabel = lyricLabels.get(newIndex);
                currentLabel.setTextFill(Color.WHITE);
                currentLabel.setFont(Font.font("Arial", FontWeight.BOLD, 20));
                
                currentLabel.requestFocus();
                
                currentIndex = newIndex;
            }
        }
    }

    private Color extractDominantColor(Image image) {
        try {
            BufferedImage bImage = SwingFXUtils.fromFXImage(image, null);
            if (bImage == null) return Color.DARKSLATEGRAY;
            
            Map<java.awt.Color, Integer> colorCount = new HashMap<>();
            int sampleStep = 5;
            
            for (int y = 0; y < bImage.getHeight(); y += sampleStep) {
                for (int x = 0; x < bImage.getWidth(); x += sampleStep) {
                    java.awt.Color color = new java.awt.Color(bImage.getRGB(x, y));
                    if (color.getRed() + color.getGreen() + color.getBlue() > 50 && 
                        color.getRed() + color.getGreen() + color.getBlue() < 700) {
                        colorCount.put(color, colorCount.getOrDefault(color, 0) + 1);
                    }
                }
            }
            
            if (colorCount.isEmpty()) return Color.DARKSLATEGRAY;
            
            java.awt.Color dominant = colorCount.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .get().getKey();
            
            return Color.rgb(dominant.getRed(), dominant.getGreen(), dominant.getBlue());
        } catch (Exception e) {
            return Color.DARKSLATEGRAY;
        }
    }

    private void showAboutDialog() {
        Alert alert = new Alert(Alert.AlertType.INFORMATION);
        alert.setTitle("À propos");
        alert.setHeaderText("Test pour intégrer cette fonction dans le Beartify");
        alert.setContentText("Version 18.0\n\nUn lecteur de musique avec enfin une bonne synchronisation  des paroles.\n\n" +
                            "Fonctionnalités:\n" +
                            "- Support multiple formats audio\n" +
                            "- Synchronisation LRC améliorée\n" +
                            "- Détection automatique des paroles\n" +
                            "- Recherche manuelle de paroles\n" +
                            "- by Papa Ours");
        alert.showAndWait();
    }

    private void showErrorDialog(String message) {
        Alert alert = new Alert(Alert.AlertType.ERROR);
        alert.setTitle("Erreur");
        alert.setHeaderText(null);
        alert.setContentText(message);
        alert.showAndWait();
    }
}