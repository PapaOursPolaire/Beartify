import javax.swing.*;
import javax.swing.border.*;
import javax.swing.text.Document;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.filechooser.FileNameExtensionFilter;
import javax.swing.text.SimpleAttributeSet;
import javax.swing.text.StyleConstants;
import javax.swing.text.StyledDocument;

import java.awt.*;
import java.awt.event.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.function.Supplier;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javafx.embed.swing.JFXPanel;
import javafx.scene.media.Media;
import javafx.scene.media.MediaPlayer;
import javafx.util.Duration;
import javafx.application.Platform;

import javax.imageio.ImageIO;
import javax.sound.sampled.*;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.FieldKey;
import uk.co.caprica.vlcj.player.component.EmbeddedMediaPlayerComponent;
import uk.co.caprica.vlcj.player.base.AudioDevice;
import uk.co.caprica.vlcj.player.base.MediaPlayerEventAdapter;

public class Beartify extends JFrame {

//Couleurs utlisées dans le logiciel
public static final Color BLACK = new Color(18, 18, 18);
public static final Color DARK_GRAY = new Color(24, 24, 24);
public static final Color MEDIUM_GRAY = new Color(40, 40, 40);
public static final Color LIGHT_GRAY = new Color(179, 179, 179);
public static final Color WHITE = new Color(255, 255, 255);
public static final Color GREEN = new Color(30, 215, 96);
public static final Color HOVER = new Color(60, 60, 60, 220);
public static final Color SEARCH_BG = new Color(60, 60, 60);

//Couleurs de base et nuances de gris
public static final Color GRAY = new Color(128, 128, 128);
public static final Color GAINSBORO = new Color(220, 220, 220);
public static final Color SLATE_GRAY = new Color(112, 128, 144);
public static final Color LIGHT_SLATE_GRAY = new Color(119, 136, 153);
public static final Color DIM_GRAY = new Color(105, 105, 105);

//Rouges
public static final Color RED = new Color(255, 0, 0);
public static final Color DARK_RED = new Color(139, 0, 0);
public static final Color FIREBRICK = new Color(178, 34, 34);
public static final Color CRIMSON = new Color(220, 20, 60);
public static final Color INDIAN_RED = new Color(205, 92, 92);
public static final Color LIGHT_CORAL = new Color(240, 128, 128);
public static final Color SALMON = new Color(250, 128, 114);
public static final Color DARK_SALMON = new Color(233, 150, 122);
public static final Color LIGHT_SALMON = new Color(255, 160, 122);
public static final Color TOMATO = new Color(255, 99, 71);

//Oranges
public static final Color ORANGE = new Color(255, 165, 0);
public static final Color DARK_ORANGE = new Color(255, 140, 0);
public static final Color CORAL = new Color(255, 127, 80);
public static final Color ORANGE_RED = new Color(255, 69, 0);
public static final Color GOLD = new Color(255, 215, 0);
public static final Color GOLDENROD = new Color(218, 165, 32);
public static final Color DARK_GOLDENROD = new Color(184, 134, 11);
public static final Color PERU = new Color(205, 133, 63);
public static final Color CHOCOLATE = new Color(210, 105, 30);
public static final Color SANDY_BROWN = new Color(244, 164, 96);

//Jaunes
public static final Color YELLOW = new Color(255, 255, 0);
public static final Color LIGHT_YELLOW = new Color(255, 255, 224);
public static final Color LEMON_CHIFFON = new Color(255, 250, 205);
public static final Color LIGHT_GOLDENROD = new Color(250, 250, 210);
public static final Color PAPAYA_WHIP = new Color(255, 239, 213);
public static final Color MOCCASIN = new Color(255, 228, 181);
public static final Color PEACH_PUFF = new Color(255, 218, 185);
public static final Color PALE_GOLDENROD = new Color(238, 232, 170);
public static final Color KHAKI = new Color(240, 230, 140);
public static final Color DARK_KHAKI = new Color(189, 183, 107);

//Verts
public static final Color LIME = new Color(0, 255, 0);
public static final Color LIME_GREEN = new Color(50, 205, 50);
public static final Color FOREST_GREEN = new Color(34, 139, 34);
public static final Color SPRING_GREEN = new Color(0, 255, 127);
public static final Color SEA_GREEN = new Color(46, 139, 87);
public static final Color MEDIUM_SEA_GREEN = new Color(60, 179, 113);
public static final Color DARK_SEA_GREEN = new Color(143, 188, 143);
public static final Color LIGHT_GREEN = new Color(144, 238, 144);
public static final Color PALE_GREEN = new Color(152, 251, 152);

//Bleus
public static final Color BLUE = new Color(0, 0, 255);
public static final Color MEDIUM_BLUE = new Color(0, 0, 205);
public static final Color DARK_BLUE = new Color(0, 0, 139);
public static final Color NAVY = new Color(0, 0, 128);
public static final Color MIDNIGHT_BLUE = new Color(25, 25, 112);
public static final Color ROYAL_BLUE = new Color(65, 105, 225);
public static final Color STEEL_BLUE = new Color(70, 130, 180);
public static final Color DODGER_BLUE = new Color(30, 144, 255);
public static final Color DEEP_SKY_BLUE = new Color(0, 191, 255);
public static final Color CORNFLOWER_BLUE = new Color(100, 149, 237);

//Violets
public static final Color PURPLE = new Color(128, 0, 128);
public static final Color INDIGO = new Color(75, 0, 130);
public static final Color DARK_MAGENTA = new Color(139, 0, 139);
public static final Color DARK_VIOLET = new Color(148, 0, 211);
public static final Color BLUE_VIOLET = new Color(138, 43, 226);
public static final Color MEDIUM_PURPLE = new Color(147, 112, 219);
public static final Color MEDIUM_SLATE_BLUE = new Color(123, 104, 238);
public static final Color SLATE_BLUE = new Color(106, 90, 205);
public static final Color REBECCA_PURPLE = new Color(102, 51, 153);
public static final Color THISTLE = new Color(216, 191, 216);

//Roses
public static final Color PINK = new Color(255, 192, 203);
public static final Color LIGHT_PINK = new Color(255, 182, 193);
public static final Color HOT_PINK = new Color(255, 105, 180);
public static final Color DEEP_PINK = new Color(255, 20, 147);
public static final Color PALE_VIOLET_RED = new Color(219, 112, 147);
public static final Color MEDIUM_VIOLET_RED = new Color(199, 21, 133);
public static final Color LAVENDER = new Color(230, 230, 250);
public static final Color LAVENDER_BLUSH = new Color(255, 240, 245);
public static final Color MISTY_ROSE = new Color(255, 228, 225);
public static final Color PLUM = new Color(221, 160, 221);

//Bruns
public static final Color BROWN = new Color(165, 42, 42);
public static final Color MAROON = new Color(128, 0, 0);
public static final Color SIENNA = new Color(160, 82, 45);
public static final Color SADDLE_BROWN = new Color(139, 69, 19);
public static final Color ROSY_BROWN = new Color(188, 143, 143);
public static final Color BURLYWOOD = new Color(222, 184, 135);
public static final Color TAN = new Color(210, 180, 140);

//Couleurs web modernes
public static final Color TWITTER_BLUE = new Color(29, 161, 242);
public static final Color FACEBOOK_BLUE = new Color(66, 103, 178);
public static final Color INSTAGRAM_PURPLE = new Color(193, 53, 132);
public static final Color YOUTUBE_RED = new Color(255, 0, 0);
public static final Color LINKEDIN_BLUE = new Color(0, 119, 181);
public static final Color SPOTIFY_GREEN = new Color(30, 215, 96);
public static final Color WHATSAPP_GREEN = new Color(37, 211, 102);
public static final Color TIKTOK_RED = new Color(255, 0, 80);
public static final Color DISCORD_BLURPLE = new Color(114, 137, 218);
public static final Color TEAL = new Color(0, 128, 128);

//Couleurs matérielles (Material Design)
public static final Color MATERIAL_RED = new Color(244, 67, 54);
public static final Color MATERIAL_PINK = new Color(233, 30, 99);
public static final Color MATERIAL_PURPLE = new Color(156, 39, 176);
public static final Color MATERIAL_DEEP_PURPLE = new Color(103, 58, 183);
public static final Color MATERIAL_INDIGO = new Color(63, 81, 181);
public static final Color MATERIAL_BLUE = new Color(33, 150, 243);
public static final Color MATERIAL_LIGHT_BLUE = new Color(3, 169, 244);
public static final Color MATERIAL_CYAN = new Color(0, 188, 212);
public static final Color MATERIAL_TEAL = new Color(0, 150, 136);
public static final Color MATERIAL_GREEN = new Color(76, 175, 80);

//Couleurs IOS
public static final Color IOS_RED = new Color(255, 59, 48);
public static final Color IOS_ORANGE = new Color(255, 149, 0);
public static final Color IOS_YELLOW = new Color(255, 204, 0);
public static final Color IOS_GREEN = new Color(52, 199, 89);
public static final Color IOS_MINT = new Color(0, 199, 190);
public static final Color IOS_TEAL = new Color(48, 176, 199);
public static final Color IOS_CYAN = new Color(50, 173, 230);
public static final Color IOS_BLUE = new Color(0, 122, 255);
public static final Color IOS_INDIGO = new Color(88, 86, 214);
public static final Color IOS_PURPLE = new Color(175, 82, 222);

//Couleurs vintage
public static final Color VINTAGE_BURGUNDY = new Color(109, 24, 35);
public static final Color VINTAGE_OLIVE = new Color(110, 117, 14);
public static final Color VINTAGE_SEPIA = new Color(112, 66, 20);
public static final Color VINTAGE_MAUVE = new Color(145, 95, 109);
public static final Color VINTAGE_EGYPTIAN_BLUE = new Color(16, 52, 166);
public static final Color VINTAGE_VERDIGRIS = new Color(67, 149, 140);
public static final Color VINTAGE_TERRA_COTTA = new Color(226, 114, 91);
public static final Color VINTAGE_MUSTARD = new Color(209, 182, 6);
public static final Color VINTAGE_CHARCOAL = new Color(54, 69, 79);
public static final Color VINTAGE_IVORY = new Color(255, 255, 240);

//Couleurs néon
public static final Color NEON_PINK = new Color(255, 16, 240);
public static final Color NEON_BLUE = new Color(31, 81, 255);
public static final Color NEON_GREEN = new Color(57, 255, 20);
public static final Color NEON_YELLOW = new Color(255, 255, 0);
public static final Color NEON_PURPLE = new Color(148, 0, 211);
public static final Color NEON_ORANGE = new Color(255, 95, 31);
public static final Color NEON_RED = new Color(255, 0, 0);
public static final Color NEON_CYAN = new Color(0, 255, 255);
public static final Color NEON_LIME = new Color(204, 255, 0);
public static final Color NEON_MAGENTA = new Color(255, 0, 144);

//Couleurs pastel
public static final Color PASTEL_PINK = new Color(255, 209, 220);
public static final Color PASTEL_BLUE = new Color(174, 198, 207);
public static final Color PASTEL_GREEN = new Color(189, 222, 192);
public static final Color PASTEL_YELLOW = new Color(253, 253, 150);
public static final Color PASTEL_PURPLE = new Color(207, 186, 240);
public static final Color PASTEL_ORANGE = new Color(250, 200, 152);
public static final Color PASTEL_RED = new Color(255, 179, 186);
public static final Color PASTEL_TEAL = new Color(178, 223, 219);
public static final Color PASTEL_LAVENDER = new Color(220, 208, 255);
public static final Color PASTEL_MINT = new Color(197, 252, 192);

//Couleurs nature
public static final Color FOREST = new Color(34, 139, 34);
public static final Color OCEAN = new Color(0, 105, 148);
public static final Color SKY = new Color(135, 206, 235);
public static final Color SUNSET = new Color(250, 214, 165);
public static final Color SAND = new Color(194, 178, 128);
public static final Color GRASS = new Color(124, 252, 0);
public static final Color EARTH = new Color(139, 69, 19);
public static final Color STORM = new Color(79, 79, 79);
public static final Color SNOW = new Color(255, 250, 250);
public static final Color LAVA = new Color(207, 16, 32);

//Couleurs métalliques
public static final Color GOLD_METAL = new Color(212, 175, 55);
public static final Color SILVER = new Color(192, 192, 192);
public static final Color BRONZE = new Color(205, 127, 50);
public static final Color COPPER = new Color(184, 115, 51);
public static final Color PLATINUM = new Color(229, 228, 226);
public static final Color IRON = new Color(161, 157, 148);
public static final Color STEEL = new Color(113, 121, 126);
public static final Color TITANIUM = new Color(135, 134, 129);
public static final Color BRASS = new Color(181, 166, 66);
public static final Color GUNMETAL = new Color(42, 52, 57);

//Couleurs alimentaires
public static final Color CHOCOLATE_BROWN = new Color(123, 63, 0);
public static final Color STRAWBERRY = new Color(252, 90, 141);
public static final Color BANANA = new Color(255, 225, 53);
public static final Color MINT = new Color(62, 180, 137);
public static final Color BLUEBERRY = new Color(79, 134, 247);
public static final Color CARROT = new Color(237, 145, 33);
public static final Color CHERRY = new Color(222, 49, 99);
public static final Color GRAPE = new Color(111, 45, 168);
public static final Color LEMON = new Color(255, 247, 0);
public static final Color WATERMELON = new Color(253, 70, 89);

//Couleurs de drapeaux
public static final Color FRENCH_BLUE = new Color(0, 85, 164);
public static final Color FRENCH_WHITE = new Color(255, 255, 255);
public static final Color FRENCH_RED = new Color(239, 65, 53);
public static final Color USA_BLUE = new Color(0, 38, 100);
public static final Color USA_RED = new Color(191, 10, 48);
public static final Color GERMAN_YELLOW = new Color(255, 204, 0);
public static final Color GERMAN_RED = new Color(255, 0, 0);
public static final Color BRAZIL_YELLOW = new Color(255, 223, 0);

//Couleurs de saisons
public static final Color SUMMER_SKY = new Color(56, 176, 222);
public static final Color AUTUMN_ORANGE = new Color(242, 133, 0);
public static final Color WINTER_BLUE = new Color(145, 168, 209);
public static final Color SPRING_BUD = new Color(167, 252, 0);
public static final Color SUMMER_SUN = new Color(255, 220, 0);
public static final Color AUTUMN_LEAF = new Color(210, 125, 45);
public static final Color WINTER_FROST = new Color(228, 240, 248);
public static final Color SPRING_FLOWER = new Color(255, 192, 203);
public static final Color SUMMER_GRASS = new Color(67, 160, 71);

//Couleurs de transports
public static final Color TAXI_YELLOW = new Color(253, 227, 6);
public static final Color BUS_RED = new Color(206, 17, 38);
public static final Color TRAIN_BLUE = new Color(0, 94, 184);
public static final Color SUBWAY_GRAY = new Color(142, 140, 140);
public static final Color AVIATION_BLUE = new Color(0, 83, 135);
public static final Color SHIPPING_CONTAINER = new Color(0, 132, 61);
public static final Color CARBON_FOOTPRINT = new Color(59, 62, 64);
public static final Color ELECTRIC_SCOOTER = new Color(255, 196, 0);
public static final Color BIKE_LANE = new Color(76, 187, 23);
public static final Color HYPERLOOP = new Color(255, 25, 100);

//Couleurs de jeux vidéo
public static final Color MINECRAFT_GREEN = new Color(58, 186, 98);
public static final Color FORTNITE_BLUE = new Color(0, 168, 252);
public static final Color LOL_GOLD = new Color(200, 155, 60);
public static final Color OVERWATCH_ORANGE = new Color(242, 103, 34);
public static final Color CSGO_RED = new Color(182, 23, 38);
public static final Color WOW_BLUE = new Color(0, 112, 222);
public static final Color POKEMON_YELLOW = new Color(255, 204, 0);
public static final Color GTA_RED = new Color(231, 29, 54);
public static final Color ZELDA_GREEN = new Color(52, 178, 51);
public static final Color MARIO_RED = new Color(226, 28, 33);

//Couleurs de marques automobiles
public static final Color FERRARI_RED = new Color(255, 40, 0);
public static final Color PORSCHE_GUARDS_RED = new Color(155, 0, 0);
public static final Color LAMBORGHINI_GREEN = new Color(0, 255, 0);
public static final Color BMW_BLUE = new Color(0, 105, 179);
public static final Color MERCEDES_SILVER = new Color(171, 171, 171);
public static final Color AUDI_GRAY = new Color(137, 137, 137);
public static final Color TESLA_RED = new Color(204, 0, 0);
public static final Color FORD_BLUE = new Color(0, 102, 179);
public static final Color TOYOTA_RED = new Color(235, 30, 40);
public static final Color VOLKSWAGEN_BLUE = new Color(0, 102, 153);

//Couleurs de boissons
public static final Color COCA_COLA_RED = new Color(237, 28, 36);
public static final Color PEPSI_BLUE = new Color(0, 88, 156);
public static final Color STARBUCKS_GREEN = new Color(0, 132, 81);
public static final Color REDBULL_BLUE = new Color(33, 66, 132);
public static final Color SPRITE_GREEN = new Color(0, 172, 66);
public static final Color MOUNTAIN_DEW_GREEN = new Color(106, 176, 35);
public static final Color FANTA_ORANGE = new Color(255, 102, 0);
public static final Color DR_PEPPER_BURGUNDY = new Color(90, 0, 35);
public static final Color MONSTER_GREEN = new Color(46, 111, 60);
public static final Color TROPICANA_ORANGE = new Color(255, 127, 0);

//Couleurs de réseaux sociaux
public static final Color INSTAGRAM_GRADIENT_START = new Color(253, 196, 47);
public static final Color INSTAGRAM_GRADIENT_END = new Color(225, 48, 108);
public static final Color PINTEREST_RED = new Color(230, 0, 35);
public static final Color SNAPCHAT_YELLOW = new Color(255, 252, 0);

//Couleurs de systèmes d'exploitation
public static final Color WINDOWS_BLUE = new Color(0, 120, 215);
public static final Color MACOS_BLUE = new Color(0, 122, 255);
public static final Color LINUX_ORANGE = new Color(223, 93, 37);
public static final Color ANDROID_GREEN = new Color(164, 198, 57);
public static final Color CHROME_BLUE = new Color(66, 133, 244);
public static final Color FIREFOX_ORANGE = new Color(230, 96, 39);
public static final Color SAFARI_BLUE = new Color(0, 122, 255);
public static final Color UBUNTU_ORANGE = new Color(233, 84, 32);
public static final Color DEBIAN_RED = new Color(215, 10, 83);

//Couleurs de fêtes
public static final Color CHRISTMAS_RED = new Color(186, 12, 47);
public static final Color CHRISTMAS_GREEN = new Color(0, 132, 61);
public static final Color HALLOWEEN_ORANGE = new Color(235, 97, 35);
public static final Color HALLOWEEN_PURPLE = new Color(106, 13, 173);
public static final Color EASTER_PINK = new Color(255, 209, 220);
public static final Color EASTER_PURPLE = new Color(192, 148, 228);
public static final Color VALENTINE_RED = new Color(214, 40, 57);
public static final Color NEW_YEAR_GOLD = new Color(212, 175, 55);
public static final Color ST_PATRICK_GREEN = new Color(0, 158, 96);
public static final Color THANKSGIVING_ORANGE = new Color(235, 97, 35);

//Couleurs de pays
public static final Color CANADA_RED = new Color(255, 0, 0);
public static final Color AUSTRALIA_GREEN = new Color(0, 102, 0);
public static final Color UK_RED = new Color(200, 16, 46);
public static final Color JAPAN_RED = new Color(188, 0, 45);
public static final Color CHINA_RED = new Color(238, 28, 37);
public static final Color INDIA_ORANGE = new Color(255, 153, 51);
public static final Color BRAZIL_GREEN = new Color(0, 156, 59);
public static final Color MEXICO_GREEN = new Color(0, 104, 71);
public static final Color ITALY_GREEN = new Color(0, 146, 70);
public static final Color GERMANY_YELLOW = new Color(255, 204, 0);

//Couleurs de sport
public static final Color OLYMPIC_BLUE = new Color(0, 129, 200);
public static final Color OLYMPIC_YELLOW = new Color(253, 203, 3);
public static final Color OLYMPIC_BLACK = new Color(0, 0, 0);
public static final Color OLYMPIC_GREEN = new Color(0, 158, 96);
public static final Color OLYMPIC_RED = new Color(226, 28, 33);
public static final Color NBA_BLUE = new Color(0, 80, 181);
public static final Color NFL_RED = new Color(200, 16, 46);
public static final Color FIFA_BLUE = new Color(0, 56, 168);
public static final Color MLB_BLUE = new Color(0, 51, 153);
public static final Color NHL_RED = new Color(200, 16, 46);

//Couleurs de musique
public static final Color APPLE_MUSIC_RED = new Color(245, 83, 83);
public static final Color YOUTUBE_MUSIC_RED = new Color(255, 0, 0);
public static final Color DEEZER_BLACK = new Color(0, 0, 0);
public static final Color TIDAL_GREEN = new Color(0, 255, 255);
public static final Color SOUNDCLOUD_ORANGE = new Color(255, 85, 0);
public static final Color PANDORA_BLUE = new Color(0, 175, 240);
public static final Color AMAZON_MUSIC_BLUE = new Color(0, 168, 252);
public static final Color SHAZAM_ORANGE = new Color(0, 168, 252);
public static final Color BANDCAMP_GREEN = new Color(30, 215, 96);

//Couleurs de technologie
public static final Color AI_PURPLE = new Color(102, 51, 153);
public static final Color VR_BLUE = new Color(0, 122, 255);
public static final Color BLOCKCHAIN_BLUE = new Color(0, 82, 204);
public static final Color IOT_GREEN = new Color(0, 158, 96);
public static final Color ROBOTICS_SILVER = new Color(192, 192, 192);
public static final Color CLOUD_BLUE = new Color(0, 168, 252);
public static final Color BIG_DATA_RED = new Color(226, 28, 33);
public static final Color CYBERSECURITY_GREEN = new Color(0, 158, 96);
public static final Color QUANTUM_PURPLE = new Color(106, 13, 173);
public static final Color NANOTECH_GOLD = new Color(212, 175, 55);

//Couleurs de mode
public static final Color FASHION_PINK = new Color(255, 105, 180);
public static final Color RUNWAY_BLACK = new Color(0, 0, 0);
public static final Color LUXURY_GOLD = new Color(212, 175, 55);
public static final Color DENIM_BLUE = new Color(21, 96, 189);
public static final Color COUTURE_RED = new Color(226, 28, 33);
public static final Color STREETWEAR_GRAY = new Color(128, 128, 128);
public static final Color VINTAGE_BROWN = new Color(139, 69, 19);
public static final Color SPORTY_ORANGE = new Color(255, 102, 0);
public static final Color ECO_GREEN = new Color(0, 158, 96);
public static final Color GLAM_PURPLE = new Color(106, 13, 173);

//Couleurs de cinéma
public static final Color NETFLIX_RED = new Color(229, 9, 20);
public static final Color DISNEY_BLUE = new Color(0, 94, 184);
public static final Color HBO_PURPLE = new Color(106, 13, 173);
public static final Color AMAZON_PRIME_BLUE = new Color(0, 168, 252);
public static final Color HULU_GREEN = new Color(30, 215, 96);
public static final Color APPLE_TV_BLACK = new Color(0, 0, 0);
public static final Color IMDB_YELLOW = new Color(245, 197, 24);
public static final Color CINEMA_RED = new Color(226, 28, 33);
public static final Color FILM_NOIR = new Color(54, 69, 79);

    //Patterns
    private static final Pattern LRC_TIME_PATTERN1 = Pattern.compile("\\[(\\d+):(\\d+)\\.(\\d+)\\]");
    private static final Pattern LRC_TIME_PATTERN2 = Pattern.compile("\\[(\\d+):(\\d+)\\]");

    //Composants UI
    private JPanel sidebarPanel;
    private JPanel mainPanel;
    private JPanel playerPanel;
    private JPanel rightPanel;
    private JList<String> playlistList;
    private JPanel songsPanel;

    private JTextField searchField;
    private JLabel currentSongLabel;
    private JLabel currentArtistLabel;
    private JLabel currentCoverLabel;
    private JButton playPauseButton;
    private JButton shuffleButton;
    private JButton repeatButton;
    private JSlider progressSlider;
    private JSlider volumeSlider;
    private JLabel totalTimeLabel;
    private JLabel currentTimeLabel;
    private JLabel volumeIcon;
    private JLabel playlistNameLabel;

    // Données
    private DefaultListModel<String> playlistModel;
    private Map<String, java.util.List<Song>> playlists;
    private java.util.List<Song> allSongs;
    private java.util.List<Song> currentPlaylist;
    private int currentSongIndex = -1;
    private java.util.List<Song> displayedSongs = null;
    private File musicDirectory;

    // Lecteur audio et modes
    private boolean isPlaying = false;
    private boolean isShuffleMode = false;
    private boolean isRepeatMode = false;
    private boolean isMuted = false;
    private int lastVolume = 50;

    // Images par défaut
    private ImageIcon defaultCoverIcon;
    private ImageIcon logoIcon;

    // Lecteur multimédia VLCJ
    private JPanel videoPanel;
    private JPanel lyricsPanel;
    private JDialog fullscreenDialog;

    //Widget vinyle
    private JDialog vinylWidget;

    // Autres en cours de test (test réussi)
    private EmbeddedMediaPlayerComponent mediaPlayerComponent;
    private Color currentDominantColor = DARK_GRAY;
    private DefaultListModel<LyricLine> lyricsModel;
    private JList<LyricLine> lyricsList; 

    // D'autres en cours de test (test réussi)
    private JLabel currentPlayerCoverLabel;
    private JLabel currentPlayerSongLabel;
    private JLabel currentPlayerArtistLabel;
    private JButton favoriteButton;
    private boolean sliderDragging = false;
    private String audioOutputDevice = null;
    private Mixer currentMixer;
    private JComboBox<String> deviceComboBox = new JComboBox<>();
    private Map<String, String> deviceMap = new HashMap<>();
    private final LyricsManager lyricsManager = new LyricsManager();

    // Nouvelles variables test
    private int currentLyricIndex = -1;

    // Variables d'images
    private ImageIcon playIcon;
    private ImageIcon pauseIcon;

    public static ImageIcon getRoundedImageIcon(ImageIcon src, int w, int h, int arc) {
    if (src == null || src.getImage() == null) {
        // Crée une image par défaut si la src est invalide
        BufferedImage defaultImg = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2d = defaultImg.createGraphics();
        g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2d.setColor(MEDIUM_GRAY);
        g2d.fillRoundRect(0, 0, w, h, arc, arc);
        g2d.setColor(LIGHT_GRAY);
        g2d.setFont(new Font("Segoe UI Emoji", Font.BOLD, 24));
        // Dessine une note de musique 🎵
        g2d.drawString("🎵", w/2 - 12, h/2 + 8);
        g2d.dispose();
        return new ImageIcon(defaultImg);
    }
    Image scaled = src.getImage().getScaledInstance(w, h, Image.SCALE_SMOOTH);
    BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g2 = image.createGraphics();
    g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g2.setClip(new java.awt.geom.RoundRectangle2D.Float(0, 0, w, h, arc, arc));
    g2.drawImage(scaled, 0, 0, w, h, null); // Utilise l'image redimensionnée
    g2.dispose();
    return new ImageIcon(image);
}

    public Beartify() {
    String[] options = {
        "--aout=directsound"  // Windows
        // "--aout=alsa"     // Linux
    };
    mediaPlayerComponent = new EmbeddedMediaPlayerComponent(options);
    initializeData();
    setupUI();
    setupEventListeners();
    selectMusicDirectory();
    setupLyricsPanel();
    lyricsManager.setLyricsList(lyricsList); // Association de la JList avec LyricsManager
    showVinylWidget();
}

    private void initializeData() {
        playlists = new HashMap<>();
        allSongs = new ArrayList<>();
        currentPlaylist = allSongs;
        playlistModel = new DefaultListModel<>();
        lyricsModel = new DefaultListModel<>();      
        playIcon = createIcon("pictures/play.png", 48, 48);
        pauseIcon = createIcon("pictures/pause.png", 48, 48);
        createDefaultCoverIcon();
        loadLogo();

        playlistModel.addElement("<html><b>Créer une nouvelle playlist ➕</b></html>");
        playlistModel.addElement("Toutes les musiques");
        playlistModel.addElement("Mes favoris");
        playlists.put("Toutes les musiques", allSongs);
        playlists.put("Mes favoris", new ArrayList<>());
    }

    private void loadLogo() {
        try {
            Image img = ImageIO.read(new File("pictures/Spotify.png")).getScaledInstance(36, 36, Image.SCALE_SMOOTH);
            logoIcon = new ImageIcon(img);
        } catch (Exception e) {
            logoIcon = null;
        }
    }

    private String formatTime(int sec) {
        int min = sec / 60;
        int s = sec % 60;
        return min + ":" + (s < 10 ? "0" : "") + s;
    }

    private void createDefaultCoverIcon() {
        int size = 64;
        BufferedImage defaultCover = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2d = defaultCover.createGraphics();
        g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        GradientPaint gradient = new GradientPaint(0, 0, MEDIUM_GRAY, size, size, DARK_GRAY);
        g2d.setPaint(gradient);
        g2d.fillOval(0, 0, size, size); 
        g2d.setColor(LIGHT_GRAY);
        g2d.setFont(new Font("Segoe UI Emoji", Font.BOLD, 24));
        FontMetrics fm = g2d.getFontMetrics();
        String note = "🎵";
        int x = (size - fm.stringWidth(note)) / 2;
        int y = (size - fm.getHeight()) / 2 + fm.getAscent();
        g2d.drawString(note, x, y);
        g2d.dispose();
        defaultCoverIcon = new ImageIcon(defaultCover); 
    }

    private void setupUI() {
        setTitle("Beartify");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(1280, 800);
        setLocationRelativeTo(null);
        setLayout(new BorderLayout(0, 0)); // Pas d'espace entre les panels, le gap est une notion css
        getContentPane().setBackground(BLACK);

        createSidebar();
        createMainPanel();
        createPlayerPanel();
        createRightPanel();

        add(createTopNavPanel(), BorderLayout.NORTH);
        add(sidebarPanel, BorderLayout.WEST);
        add(mainPanel, BorderLayout.CENTER);
        add(playerPanel, BorderLayout.SOUTH);
        add(rightPanel, BorderLayout.EAST);
    }

    private JPanel createTopNavPanel() {
    JPanel topNavPanel = new JPanel(new BorderLayout());
    topNavPanel.setBackground(BLACK);
    topNavPanel.setBorder(new EmptyBorder(8, 0, 8, 0));
    topNavPanel.setPreferredSize(new Dimension(getWidth(), 60));

    // Panel gauche pour les boutons de navigation
    JPanel navButtonsPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 5, 0));
    navButtonsPanel.setBackground(BLACK);

    // Bouton Reculer
    JButton plusButton = createIconButton("Etc.png", "Plus", 32, 32);
    navButtonsPanel.add(plusButton);
    //navButtonsPanel.add(Box.createHorizontalStrut(2));

    // Bouton Reculer (y'en  a deux faut pas  poser de question)
    JButton backButton = createIconButton("PreviousArrow.png", "Reculer", 32, 32);
    navButtonsPanel.add(backButton);
    //navButtonsPanel.add(Box.createHorizontalStrut(2));

    // Bouton Avancer
    JButton forwardButton = createIconButton("NextArrow.png", "Avancer", 32, 32);
    navButtonsPanel.add(forwardButton);
    //navButtonsPanel.add(Box.createHorizontalStrut(2));

    // Bouton Accueil
    JButton homeButton = createIconButton("Home.png", "Accueil", 32, 32);
    homeButton.addActionListener(e -> loadPlaylist("Toutes les musiques"));
    navButtonsPanel.add(homeButton);
    //navButtonsPanel.add(Box.createHorizontalStrut(2)); fait buguer le panel

    // Bouton Recherche avec champ dépliant (bugue un peu)
    JButton searchButton = createIconButton("Search.png", "Rechercher", 32, 32);
    navButtonsPanel.add(searchButton);

    JTextField navSearchField = new JTextField(20);
    navSearchField.setVisible(false);
    navSearchField.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 14));
    navSearchField.setBackground(BLACK);
    navSearchField.setForeground(WHITE);
    navSearchField.setCaretColor(WHITE);
    navSearchField.setBorder(new RoundedBorder(WHITE, 20, 2));
    navSearchField.setPreferredSize(new Dimension(200, 36));
    navSearchField.putClientProperty("JTextField.placeholderText", "Rechercher...");

    // Bouton de fermeture pour effacer la recherche (bugue aussi)
    JButton clearSearchButton = new JButton("✕");
    clearSearchButton.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 12));
    clearSearchButton.setBorderPainted(false);
    clearSearchButton.setContentAreaFilled(false);
    clearSearchButton.setForeground(LIGHT_GRAY);
    clearSearchButton.setCursor(new Cursor(Cursor.HAND_CURSOR));
    clearSearchButton.setVisible(false);
    clearSearchButton.addActionListener(e -> {
        navSearchField.setText("");
        performSearch(""); // Réinitialise l'affichage
        clearSearchButton.setVisible(false);
    });

    // Layout personnalisé pour le champ de recherche (lui aussi bugué)
    JPanel searchWrapper = new JPanel(new BorderLayout());
    searchWrapper.setBorder(new EmptyBorder(0, 0, 0, 0));
    searchWrapper.setOpaque(false);
    searchWrapper.add(navSearchField, BorderLayout.CENTER);
    searchWrapper.add(clearSearchButton, BorderLayout.EAST);

// Action de recherche
navSearchField.addActionListener(e -> {
    String query = navSearchField.getText().trim().toLowerCase();
    clearSearchButton.setVisible(!query.isEmpty());
    performSearch(query);
});

// Listener pour le texte modifié
navSearchField.getDocument().addDocumentListener(new DocumentListener() {
    @Override
    public void insertUpdate(DocumentEvent e) {
        updateSearch();
    }

    @Override
    public void removeUpdate(DocumentEvent e) {
        updateSearch();
    }

    @Override
    public void changedUpdate(DocumentEvent e) {
        updateSearch();
    }

    private void updateSearch() {
        String query = navSearchField.getText().trim().toLowerCase();
        clearSearchButton.setVisible(!query.isEmpty());
        performSearch(query);
    }
});

    // Action pour afficher/cacher le champ de recherche
    searchButton.addActionListener(e -> {
        navSearchField.setVisible(!navSearchField.isVisible());
        if (navSearchField.isVisible()) {
            navSearchField.requestFocusInWindow();
        }
        topNavPanel.revalidate();
    });

    // Action de recherche
    navSearchField.addActionListener(e -> {
        String query = navSearchField.getText().trim().toLowerCase();
        performSearch(query);
    });

    // Panel droit pour les autres boutons
    JPanel rightButtonsPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 0, 0));
    rightButtonsPanel.setBackground(BLACK);

    // Bouton Notifications (inactif)
    JButton notifButton = createIconButton("notif.png", "Notifications", 32, 32);
    rightButtonsPanel.add(notifButton);

    // Bouton Activités (inactif)
    JButton activityButton = createIconButton("friends.png", "Activités de vos amis", 32, 32);
    rightButtonsPanel.add(activityButton);

    // Bouton Paramètres (inactif)
    JButton settingsButton = createIconButton("settings.png", "Paramètres", 32, 32);
    rightButtonsPanel.add(settingsButton);

    // Bouton Profil (inactif)
    JButton profileButton = createIconButton("profile.png", "Profil", 32, 32);
    rightButtonsPanel.add(profileButton);

    // Assemblage du panel
    //topNavPanel.add(searchWrapper, BorderLayout.CENTER); fait buguer le truc jsp pq
    topNavPanel.add(navButtonsPanel, BorderLayout.WEST);
    topNavPanel.add(navSearchField, BorderLayout.CENTER);
    topNavPanel.add(rightButtonsPanel, BorderLayout.EAST);

    return topNavPanel;
}

    private void performSearch(String query) {
    if (query.isEmpty()) {
        updateSongDisplay();
        return;
    }
    
    List<Song> filteredSongs = new ArrayList<>();
    for (Song song : allSongs) {
        if ((song.getTitle() != null && song.getTitle().toLowerCase().contains(query)) ||
            (song.getArtist() != null && song.getArtist().toLowerCase().contains(query)) ||
            (song.getAlbum() != null && song.getAlbum().toLowerCase().contains(query))) {
            filteredSongs.add(song);
        }
    }
    updateSongDisplay(filteredSongs);
}


    private JButton createIconButton(String iconName, String tooltip, int width, int height) {
    JButton button = new JButton();
    button.setToolTipText(tooltip);
    button.setBackground(BLACK);
    button.setBorderPainted(false);
    button.setFocusPainted(false);
    button.setContentAreaFilled(false);
    
    try {
        Image img = ImageIO.read(new File("pictures/" + iconName))
                        .getScaledInstance(width, height, Image.SCALE_SMOOTH);
        button.setIcon(new ImageIcon(img));
    } catch (Exception e) {
        button.setText(tooltip.substring(0, 1));
        button.setFont(new Font("Segoe UI Emoji", Font.BOLD, 14));
    }
    
    button.setCursor(new Cursor(Cursor.HAND_CURSOR));
    return button;
}

    private void createSidebar() {
        sidebarPanel = new JPanel(new BorderLayout());
        sidebarPanel.setBackground(BLACK);
        sidebarPanel.setPreferredSize(new Dimension(280, getHeight())); 
        sidebarPanel.setBorder(new EmptyBorder(24, 24, 24, 0)); 

        JPanel logoPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        logoPanel.setBackground(BLACK);

        if (logoIcon != null) {
            JLabel logoImg = new JLabel(logoIcon);
            logoPanel.add(logoImg);
            logoPanel.add(Box.createHorizontalStrut(8));
        }
        JLabel logoText = new JLabel("Beartify");
        logoText.setFont(new Font("Segoe UI Emoji", Font.BOLD, 24));
        logoText.setForeground(WHITE);
        logoPanel.add(logoText);

        JPanel menuPanel = new JPanel();
        menuPanel.setLayout(new BoxLayout(menuPanel, BoxLayout.Y_AXIS));
        menuPanel.setBackground(BLACK);
        menuPanel.setBorder(new EmptyBorder(32, 0, 24, 0));

        String[] menuItems = {"🏠 Accueil", "🔍 Rechercher", "📚 Votre bibliothèque"}; //Remplace rles émojis dans le futur mais flemme pour l'instant hassoul
        for (String item : menuItems) {
            JButton menuButton = createModernMenuButton(item);
            menuPanel.add(menuButton);
            menuPanel.add(Box.createVerticalStrut(8));
        }

        JButton selectFolderButton = createModernMenuButton("📁 Sélectionner dossier");
        selectFolderButton.addActionListener(e -> selectMusicDirectory());
        JButton addMusicButton = createModernMenuButton("➕ Ajouter musique");
        addMusicButton.addActionListener(e -> addMusicFiles());
        menuPanel.add(selectFolderButton);
        menuPanel.add(Box.createVerticalStrut(8));
        menuPanel.add(addMusicButton);

        JButton createPlaylistButton = createModernMenuButton("➕ Créer une nouvelle playlist");
        createPlaylistButton.addActionListener(e -> createNewPlaylist());
        menuPanel.add(createPlaylistButton);
        menuPanel.add(Box.createVerticalStrut(8));

        JLabel playlistTitle = new JLabel("PLAYLISTS");
        playlistTitle.setFont(new Font("Segoe UI Emoji", Font.BOLD, 20));
        playlistTitle.setForeground(GREEN);
        playlistTitle.setBorder(new EmptyBorder(16, 0, 8, 0));
        menuPanel.add(playlistTitle);

        playlistList = new JList<>(playlistModel);
        playlistList.setBackground(BLACK);
        playlistList.setForeground(WHITE);
        playlistList.setSelectionBackground(MEDIUM_GRAY);
        playlistList.setSelectionForeground(WHITE);
        playlistList.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 14));
        playlistList.setBorder(new EmptyBorder(8, 0, 8, 0));
        playlistList.setCellRenderer(new ModernPlaylistCellRenderer());
        JScrollPane playlistScrollPane = new JScrollPane(playlistList);
        playlistScrollPane.setBackground(BLACK);
        playlistScrollPane.setBorder(null);
        playlistScrollPane.getVerticalScrollBar().setUI(new ModernScrollBarUI());
        playlistScrollPane.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);

        sidebarPanel.add(logoPanel, BorderLayout.NORTH);
        JPanel centerPanel = new JPanel(new BorderLayout());
        centerPanel.setBackground(BLACK);
        centerPanel.add(menuPanel, BorderLayout.NORTH);
        centerPanel.add(playlistScrollPane, BorderLayout.CENTER);
        sidebarPanel.add(centerPanel, BorderLayout.CENTER);
    }

    private void createMainPanel() {
        mainPanel = new JPanel(new BorderLayout(0, 0));
        mainPanel.setBackground(DARK_GRAY);
        mainPanel.setPreferredSize(new Dimension(500, getHeight()));

        songsPanel = new JPanel();
        songsPanel.setLayout(new BoxLayout(songsPanel, BoxLayout.Y_AXIS));
        songsPanel.setBackground(DARK_GRAY);

        JScrollPane songScrollPane = new JScrollPane(songsPanel);
        songScrollPane.setBackground(DARK_GRAY);
        songScrollPane.setBorder(null);
        songScrollPane.getVerticalScrollBar().setUI(new ModernScrollBarUI());
        songScrollPane.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);

        mainPanel.add(songScrollPane, BorderLayout.CENTER);

    }

    private void setPanelAndChildrenBg(JComponent comp, Color color) {
        comp.setBackground(color);
        for (Component c : comp.getComponents()) {
            if (c instanceof JComponent) {
                setPanelAndChildrenBg((JComponent) c, color);
            }
        }
    }

    private void createRightPanel() {
    if (mediaPlayerComponent == null) {
        mediaPlayerComponent = new EmbeddedMediaPlayerComponent();
    }

    rightPanel = new JPanel(new BorderLayout(0, 0)) {
        @Override
        protected void paintComponent(Graphics g) {
            super.paintComponent(g);
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setColor(currentDominantColor);
            g2.fillRect(0, 0, getWidth(), getHeight());
            g2.dispose();
        }
    };
    rightPanel.setPreferredSize(new Dimension(400, getHeight()));

    JPanel centerWrapper = new JPanel(new GridBagLayout());
    centerWrapper.setOpaque(false);
    GridBagConstraints gbc = new GridBagConstraints();
    gbc.gridx = 0;
    gbc.gridy = 0;
    gbc.weightx = 1;
    gbc.weighty = 1;
    gbc.fill = GridBagConstraints.BOTH;

    JPanel rightContentPanel = new JPanel();
    rightContentPanel.setLayout(new BoxLayout(rightContentPanel, BoxLayout.Y_AXIS));
    rightContentPanel.setOpaque(false);
    rightContentPanel.setBackground(new Color(0, 0, 0, 0));
    rightContentPanel.setBorder(new EmptyBorder(20, 20, 20, 20));

    // Cover centrée
    JPanel coverPanel = new JPanel(new FlowLayout(FlowLayout.CENTER, 0, 0));
    coverPanel.setOpaque(false);
    coverPanel.setBorder(new EmptyBorder(0, 0, 0, 0));
    currentCoverLabel = new JLabel(defaultCoverIcon);
    currentCoverLabel.setPreferredSize(new Dimension(320, 320));
    coverPanel.add(currentCoverLabel);

    // Infos titre + artiste/album centrées
    JPanel titleArtistPanel = new JPanel();
    titleArtistPanel.setLayout(new BoxLayout(titleArtistPanel, BoxLayout.Y_AXIS));
    titleArtistPanel.setOpaque(false);
    titleArtistPanel.setAlignmentX(Component.CENTER_ALIGNMENT);

    currentSongLabel = new MarqueeLabel("", new Font("Segoe UI Emoji", Font.BOLD, 18), WHITE);
    currentSongLabel.setAlignmentX(Component.CENTER_ALIGNMENT);
    currentArtistLabel = new MarqueeLabel("", new Font("Segoe UI Emoji", Font.PLAIN, 16), LIGHT_GRAY);
    currentArtistLabel.setAlignmentX(Component.CENTER_ALIGNMENT);

    titleArtistPanel.add(Box.createVerticalGlue());
    titleArtistPanel.add(currentSongLabel);
    titleArtistPanel.add(currentArtistLabel);
    titleArtistPanel.add(Box.createVerticalGlue());

    // Bloc vidéo centré
    videoPanel = new JPanel(new BorderLayout());
    videoPanel.setVisible(false); 
    videoPanel.setPreferredSize(new Dimension(320, 320));
    videoPanel.setMaximumSize(new Dimension(320, 320));
    videoPanel.setOpaque(false);
    mediaPlayerComponent.setPreferredSize(new Dimension(320, 320));
    mediaPlayerComponent.setMaximumSize(new Dimension(320, 320));
    mediaPlayerComponent.setMinimumSize(new Dimension(320, 320));
    videoPanel.add(mediaPlayerComponent, BorderLayout.CENTER);

    // Bloc paroles avec scrollbar complètement cachée enfin j'espère
    lyricsPanel = new JPanel(new BorderLayout());
    lyricsPanel.setOpaque(false);
    lyricsPanel.setPreferredSize(new Dimension(360, 200));
    lyricsPanel.setMaximumSize(new Dimension(360, 200));

    lyricsList = new JList<>(lyricsModel) {
        @Override
        public Dimension getPreferredScrollableViewportSize() {
            return new Dimension(360, 200);
        }
    
        @Override
        public int getScrollableUnitIncrement(Rectangle visibleRect, int orientation, int direction) {
            return 30;
        }
    };
    lyricsList.setFixedCellHeight(-1); // Hauteur à ajuster mais là ça marche bien
    lyricsList.setFocusable(false);
    lyricsList.setSelectionModel(new DefaultListSelectionModel() {
        @Override
        public void setSelectionInterval(int index0, int index1) {
            super.setSelectionInterval(-1, -1);
        }
    });
    
    lyricsList.setCellRenderer(new LyricsRenderer());
    lyricsList.setFixedCellHeight(-1); 
    lyricsList.setOpaque(false);
    lyricsList.setBackground(new Color(0, 0, 0, 0));
    lyricsList.setSelectionBackground(new Color(0, 0, 0, 0));
    
    JScrollPane lyricsScrollPane = new JScrollPane(lyricsList) {
        @Override
        public Dimension getPreferredSize() {
            return new Dimension(360, 200);
        }
    };
    lyricsScrollPane.setBorder(null);
    lyricsScrollPane.setOpaque(false);
    lyricsScrollPane.getViewport().setOpaque(false);
    lyricsScrollPane.setVerticalScrollBarPolicy(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER);
    lyricsScrollPane.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
    
    // Conteneur pour centrage vertical
    JPanel lyricsCenterWrapper = new JPanel(new GridBagLayout());
    lyricsCenterWrapper.setOpaque(false);
    lyricsCenterWrapper.add(lyricsScrollPane);
    lyricsPanel.add(lyricsCenterWrapper, BorderLayout.CENTER);

    
    // Ajout des composants avec centrage
    rightContentPanel.add(coverPanel);
    rightContentPanel.add(Box.createVerticalStrut(12));
    rightContentPanel.add(titleArtistPanel);
    rightContentPanel.add(Box.createVerticalStrut(24));
    rightContentPanel.add(videoPanel);
    rightContentPanel.add(Box.createVerticalStrut(24));
    rightContentPanel.add(lyricsPanel);
    
    // Crée un JScrollPane et y ajouter le contenu
    JScrollPane scrollPane = new JScrollPane(rightContentPanel);
    scrollPane.setBorder(null);
    scrollPane.setOpaque(false);
    scrollPane.getViewport().setOpaque(false);
    scrollPane.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
    scrollPane.setVerticalScrollBarPolicy(ScrollPaneConstants.VERTICAL_SCROLLBAR_ALWAYS);
    scrollPane.getVerticalScrollBar().setUI(new ModernScrollBarUI());
    
    // Ajouter le scrollPane au wrapper
    centerWrapper.add(scrollPane, gbc);
    rightPanel.add(centerWrapper, BorderLayout.CENTER);
}

    private class MarqueeLabel extends JLabel implements ActionListener {
        private int offset = 0;
        private int speed = 30; //en ms
        private javax.swing.Timer timer; 
        private int textWidth = 0;
        private boolean scrolling = false;

    public MarqueeLabel(String text, Font font, Color color) {
        super(text);
        setFont(font);
        setForeground(color);
        setOpaque(false); // Rend transparent
        setBackground(new Color(0,0,0,0)); // Fond transparent
        setHorizontalAlignment(LEFT);
        setVerticalAlignment(CENTER);
        setPreferredSize(new Dimension(360, 32));
    }

        @Override
        public void setText(String text) {
        super.setText(text);
        if (getFont() == null) return; // Ajouté pour éviter le NPE (NullPointerException) et je sais tj pas ce que ça veut dire merci stackoverflow
        FontMetrics fm = getFontMetrics(getFont());
        textWidth = fm.stringWidth(text);
        offset = 0;
        if (timer != null) timer.stop();
        scrolling = textWidth > getPreferredSize().width;
        if (scrolling) {
            timer = new javax.swing.Timer(speed, this);
            timer.start();
        }
        repaint();
    }

    public boolean isTextTruncated() {
        return textWidth > getPreferredSize().width;
    }   

        @Override
    protected void paintComponent(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        
        if (scrolling) {
            g2.setColor(getForeground());
            FontMetrics fm = g2.getFontMetrics(getFont());
            int y = (getHeight() + fm.getAscent() - fm.getDescent()) / 2;
            g2.drawString(getText(), -offset, y);
            g2.drawString(getText(), textWidth - offset + 32, y);
        } else {
            // Dessin normal pour texte court
            super.paintComponent(g2);
        }
        g2.dispose();
    }


        @Override
        public void actionPerformed(ActionEvent e) {
            offset += 2;
            if (offset > textWidth + 32) offset = 0;
            repaint();
        }
    }
// Affichage vidéo en grand écran (n'affiche qu'un fond blanc à y remédier)
    private void showFullscreenVideo() {
    if (fullscreenDialog != null && fullscreenDialog.isVisible()) return;
    fullscreenDialog = new JDialog(this, "Vidéo - Grand écran", true);
    fullscreenDialog.setUndecorated(true);
    fullscreenDialog.setBackground(new Color(0,0,0,200));
    fullscreenDialog.setLayout(new BorderLayout());

    Container oldParent = mediaPlayerComponent.getParent();
    if (oldParent != null) {
        oldParent.remove(mediaPlayerComponent);
        oldParent.revalidate();
        oldParent.repaint();
    }

    JPanel fsVideoPanel = new JPanel(new BorderLayout()) {
        @Override
        protected void paintComponent(Graphics g) {
            super.paintComponent(g);
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setColor(MEDIUM_GRAY);
            g2.fillRoundRect(0, 0, getWidth(), getHeight(), 32, 32);
            g2.setColor(LIGHT_GRAY);
            g2.setStroke(new BasicStroke(2));
            g2.drawRoundRect(0, 0, getWidth()-1, getHeight()-1, 32, 32);
            g2.dispose();
        }
    };
    fsVideoPanel.setPreferredSize(new Dimension(900, 540));
    fsVideoPanel.setOpaque(false);

    mediaPlayerComponent.setPreferredSize(new Dimension(900, 540));
    fsVideoPanel.add(mediaPlayerComponent, BorderLayout.CENTER);

    JButton closeBtn = new JButton("Fermer");
    closeBtn.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 18));
    closeBtn.setBackground(MEDIUM_GRAY);
    closeBtn.setForeground(WHITE);
    closeBtn.setBorder(new EmptyBorder(8, 24, 8, 24));
    closeBtn.setFocusPainted(false);
    closeBtn.setCursor(new Cursor(Cursor.HAND_CURSOR));
    closeBtn.addActionListener(e -> {
        fsVideoPanel.remove(mediaPlayerComponent);
        mediaPlayerComponent.setPreferredSize(new Dimension(320, 320));
        videoPanel.add(mediaPlayerComponent, BorderLayout.CENTER);
        videoPanel.revalidate();
        videoPanel.repaint();
        fullscreenDialog.dispose();
    });

    JPanel btnPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 0, 0));
    btnPanel.setOpaque(false);
    btnPanel.add(closeBtn);

    fullscreenDialog.add(fsVideoPanel, BorderLayout.CENTER);
    fullscreenDialog.add(btnPanel, BorderLayout.SOUTH);
    fullscreenDialog.setSize(1000, 600);
    fullscreenDialog.setLocationRelativeTo(this);
    fullscreenDialog.setVisible(true);
}

    public class LyricsDialog extends JDialog {
    private final DefaultListModel<LyricLine> model;
    private int currentIndex;
    private final Supplier<Double> timeSupplier;
    private javax.swing.Timer updateTimer; // Spécifier javax.swing.Timer prcq l'autre il marche pas ptn
    
    public LyricsDialog(DefaultListModel<LyricLine> model, int currentIndex, Supplier<Double> timeSupplier) {
        this.model = model;
        this.currentIndex = currentIndex;
        this.timeSupplier = timeSupplier;
        initUI();
        startUpdateTimer();
        centerCurrentLyric();
    }

    private void startUpdateTimer() {
        updateTimer = new javax.swing.Timer(100, e -> {
            double currentTime = timeSupplier.get();
            int newIndex = -1;
            for (int i = 0; i < model.getSize(); i++) {
                LyricLine line = model.getElementAt(i);
                if (line.time <= currentTime) {
                    newIndex = i;
                } else {
                    break;
                }
            }
            if (newIndex != currentIndex) {
                currentIndex = newIndex;
                lyricsList.repaint();
                centerCurrentLyric(); // Centre après changement
            }
        });
        updateTimer.start();
    }


    private void initUI() {
        setTitle("Paroles");
        setUndecorated(true);
        setBackground(new Color(0, 0, 0, 220));
        setLayout(new BorderLayout());
        setSize(900, 700);
        setLocationRelativeTo(Beartify.this);

        // Panel principal avec effet de transparence
        JPanel contentPanel = new JPanel(new BorderLayout()) {
            @Override
            protected void paintComponent(Graphics g) {
                super.paintComponent(g);
                Graphics2D g2d = (Graphics2D) g.create();
                g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g2d.setColor(new Color(30, 30, 30, 240));
                g2d.fillRoundRect(0, 0, getWidth(), getHeight(), 30, 30);
                g2d.dispose();
            }
        };
        contentPanel.setOpaque(true); // Rend opaque
        contentPanel.setBackground(new Color(30, 30, 30)); // Fond sombre
        contentPanel.setBorder(new EmptyBorder(20, 20, 20, 20));

        // Configuration de la liste des paroles
        lyricsList = new JList<>(model);
        lyricsList.setCellRenderer(new FullscreenLyricsRenderer(currentIndex));
        lyricsList.setFixedCellHeight(-1);
        lyricsList.setLayoutOrientation(JList.VERTICAL_WRAP);
        lyricsList.setVisibleRowCount(-1);
        lyricsList.setFixedCellHeight(-1);
        
        // Désactive la sélection
        lyricsList.setSelectionModel(new DefaultListSelectionModel() {
            @Override
            public void setSelectionInterval(int index0, int index1) {
                super.setSelectionInterval(-1, -1);
            }
        });

        JScrollPane scrollPane = new JScrollPane(lyricsList);
        scrollPane.setBorder(null);
        scrollPane.getViewport().setBackground(new Color(0, 0, 0, 0));
        scrollPane.setOpaque(false);
        scrollPane.getVerticalScrollBar().setUI(new ModernScrollBarUI());
        scrollPane.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);

        // Header avec titre et bouton fermer
        JPanel headerPanel = new JPanel(new BorderLayout());
        headerPanel.setOpaque(false);
        
        JLabel titleLabel = new JLabel("Paroles");
        titleLabel.setFont(new Font("Segoe UI Emoji", Font.BOLD, 24));
        titleLabel.setForeground(GREEN);
        headerPanel.add(titleLabel, BorderLayout.WEST);
        
        JButton closeButton = new JButton("✕");
        closeButton.setFont(new Font("Segoe UI Emoji", Font.BOLD, 20));
        closeButton.setForeground(WHITE);
        closeButton.setBorderPainted(false);
        closeButton.setContentAreaFilled(false);
        closeButton.setFocusPainted(false);
        closeButton.addActionListener(e -> dispose());
        closeButton.setCursor(new Cursor(Cursor.HAND_CURSOR));
        headerPanel.add(closeButton, BorderLayout.EAST);

        contentPanel.add(headerPanel, BorderLayout.NORTH);
        contentPanel.add(scrollPane, BorderLayout.CENTER);

        add(contentPanel, BorderLayout.CENTER);

        // Centre la ligne actuelle
        SwingUtilities.invokeLater(() -> {
            if (currentIndex >= 0) {
                lyricsList.ensureIndexIsVisible(currentIndex);
                Rectangle cellRect = lyricsList.getCellBounds(currentIndex, currentIndex);
                if (cellRect != null) {
                    int centerY = cellRect.y - (lyricsList.getVisibleRect().height - cellRect.height) / 2;
                    lyricsList.scrollRectToVisible(new Rectangle(0, centerY, 10, lyricsList.getHeight()));
                }
            }
        });
        
        // Permet le déplacement de la fenêtre
        final Point[] offset = new Point[1];
        headerPanel.addMouseListener(new MouseAdapter() {
            public void mousePressed(MouseEvent e) {
                offset[0] = new Point(e.getX(), e.getY());
            }
        });
        headerPanel.addMouseMotionListener(new MouseMotionAdapter() {
            public void mouseDragged(MouseEvent e) {
                Point curr = e.getLocationOnScreen();
                setLocation(curr.x - offset[0].x, curr.y - offset[0].y);
            }
        });
    }

    private class EnhancedLyricsRenderer implements ListCellRenderer<LyricLine> {
    @Override
    public Component getListCellRendererComponent(JList<? extends LyricLine> list, 
                                                LyricLine value, 
                                                int index, 
                                                boolean isSelected, 
                                                boolean cellHasFocus) {
        JLabel label = new JLabel(value.text);
        label.setOpaque(true);
        label.setBackground(index == currentIndex ? new Color(40,40,40) : new Color(30,30,30));
        
        if (index == currentIndex) {
            label.setForeground(GREEN);
            label.setFont(label.getFont().deriveFont(Font.BOLD, 32f));
        } else {
            label.setForeground(WHITE);
            label.setFont(label.getFont().deriveFont(Font.PLAIN, 24f));
        }
        return label;
    }
}
    }

    private static class LyricLine {
    double time;
    String text;
    String wrappedText; // Texte avec retours à la ligne qui marche pas réellement, à y remédier mais y'a trop de choses qui fontionnent pas pour l'instant
    
    public LyricLine(double time, String text) {
        this.time = time;
        this.text = text;
    }
}
    
    private class LyricsRenderer implements ListCellRenderer<LyricLine> {
    @Override
    public Component getListCellRendererComponent(JList<? extends LyricLine> list, 
                                                LyricLine value, 
                                                int index, 
                                                boolean isSelected, 
                                                boolean cellHasFocus) {
        
        JTextArea textArea = new JTextArea(value.text);
        textArea.setWrapStyleWord(true);
        textArea.setLineWrap(true);
        textArea.setOpaque(false);
        textArea.setEditable(false);
        textArea.setFocusable(false);
        textArea.setFont(list.getFont());
        
        // Applique les styles, à y remédier pour que ça marche vraiment
        if (index == currentLyricIndex) {
            textArea.setForeground(GREEN);
            textArea.setFont(textArea.getFont().deriveFont(Font.BOLD, 18f));
        } else if (index == currentLyricIndex + 1 || index == currentLyricIndex + 2) {
            textArea.setForeground(WHITE);
            textArea.setFont(textArea.getFont().deriveFont(Font.PLAIN, 16f));
        } else if (index == currentLyricIndex - 1 || index == currentLyricIndex - 2) {
            textArea.setForeground(new Color(150, 150, 150, 180));
            textArea.setFont(textArea.getFont().deriveFont(Font.PLAIN, 14f));
        } else if (index < currentLyricIndex) {
            textArea.setForeground(new Color(150, 150, 150, 120));
            textArea.setFont(textArea.getFont().deriveFont(Font.PLAIN, 12f));
        } else {
            textArea.setForeground(WHITE);
            textArea.setFont(textArea.getFont().deriveFont(Font.PLAIN, 16f));
        }
        
        // Ajuste la hauteur et la taille (ça marche pas en vrai mais chut)
        textArea.setSize(list.getWidth() - 30, Short.MAX_VALUE);
        int height = textArea.getPreferredSize().height + 10;
        textArea.setPreferredSize(new Dimension(list.getWidth(), height));
        
        return textArea;
    }
}

    private class FullscreenLyricsRenderer implements ListCellRenderer<LyricLine> {
    private final int currentIndex;

    public FullscreenLyricsRenderer(int currentIndex) {
        this.currentIndex = currentIndex;
    }

    @Override
    public Component getListCellRendererComponent(JList<? extends LyricLine> list, 
                                                LyricLine value, 
                                                int index, 
                                                boolean isSelected, 
                                                boolean cellHasFocus) {
        
        JTextPane textPane = new JTextPane();
        textPane.setContentType("text/html");
        textPane.setEditable(false);
        textPane.setOpaque(false);
        textPane.setBorder(BorderFactory.createEmptyBorder(10, 30, 10, 30));
        textPane.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 28));
        
        // Style avec prise en charge des émojis mais à revoir car bouffé par les autres classes
        String html = "<html><body style='text-align:center; font-family:Segoe UI Emoji, sans-serif;'>";
        
        if (index == currentIndex) {
            html += "<div style='color:#1ED760; font-weight:bold; font-size:32pt;'>"
                    + escapeHtml(value.text) + "</div>";
        } else if (Math.abs(index - currentIndex) == 1) {
            html += "<div style='color:#FFFFFF; font-size:28pt;'>"
                    + escapeHtml(value.text) + "</div>";
        } else {
            html += "<div style='color:#B3B3B3; font-size:24pt;'>"
                    + escapeHtml(value.text) + "</div>";
        }
        
        html += "</body></html>";
        textPane.setText(html);
        
        return textPane;
    }
}


    private void centerCurrentLyric() { // Encore à perfectionner
    if (currentLyricIndex < 0 || currentLyricIndex >= lyricsModel.getSize()) return;
    
    SwingUtilities.invokeLater(() -> {
        // Récupére le JScrollPane parent
        JScrollPane scrollPane = (JScrollPane) SwingUtilities.getAncestorOfClass(
            JScrollPane.class, 
            lyricsList
        );
        
        if (scrollPane == null) return;
        
        // Attend que l'UI soit rendue
        lyricsList.scrollRectToVisible(new Rectangle());
        
        // Calcule la position centrale
        Rectangle cellRect = lyricsList.getCellBounds(currentLyricIndex, currentLyricIndex);
        if (cellRect != null) {
            Rectangle visible = lyricsList.getVisibleRect();
            int centerY = cellRect.y + cellRect.height / 2;
            int scrollY = centerY - visible.height / 2;
            
            // Défini la nouvelle position de défilement
            JScrollBar vertical = scrollPane.getVerticalScrollBar();
            vertical.setValue(scrollY);
        }
    });
}

    private void loadLyricsForSong(Song song) {
    lyricsModel.clear();
    currentLyricIndex = -1;

    try {
        File songFile = new File(song.getFilePath());
        File lyricsDir = new File(songFile.getParentFile(), "lyrics");
        String baseName = songFile.getName().replaceAll("(?i)\\.mp3$", "");
        File lrcFile = new File(lyricsDir, baseName + ".lrc");
        
        if (lrcFile.exists()) {
            List<String> lines = Files.readAllLines(lrcFile.toPath(), StandardCharsets.UTF_8);
            List<LyricLine> lyricLines = new ArrayList<>(); // Créer une nouvelle liste de LyricLine
            
            for (String line : lines) {
                Matcher m1 = LRC_TIME_PATTERN1.matcher(line);
                Matcher m2 = LRC_TIME_PATTERN2.matcher(line);
                
                if (m1.find()) {
                    int min = Integer.parseInt(m1.group(1));
                    int sec = Integer.parseInt(m1.group(2));
                    int ms = Integer.parseInt(m1.group(3));
                    double time = min * 60 + sec + ms / 100.0;
                    String text = line.substring(m1.end()).trim();
                    lyricLines.add(new LyricLine(time, text));
                    lyricsModel.addElement(new LyricLine(time, text));
                } else if (m2.find()) {
                    int min = Integer.parseInt(m2.group(1));
                    int sec = Integer.parseInt(m2.group(2));
                    double time = min * 60 + sec;
                    String text = line.substring(m2.end()).trim();
                    lyricLines.add(new LyricLine(time, text));
                    lyricsModel.addElement(new LyricLine(time, text));
                }
            }
            
            lyricsManager.setLyrics(lyricLines); // Passer la liste convertie
        }
    } catch (Exception e) {
        lyricsModel.addElement(new LyricLine(0, "Paroles non disponibles"));
    }
    
    SwingUtilities.invokeLater(() -> {
        lyricsList.setFixedCellHeight(-1);
        lyricsList.updateUI();
    });
}


    private void scrollToCenter(int index) {
    if (index < 0 || index >= lyricsModel.size()) return;
    
    Rectangle cellRect = lyricsList.getCellBounds(index, index);
    Rectangle visible = lyricsList.getVisibleRect();
    
    int cellCenterY = cellRect.y + cellRect.height / 2;
    int viewCenterY = visible.y + visible.height / 2;
    
    if (cellCenterY != viewCenterY) {
        int newY = cellRect.y - (visible.height - cellRect.height) / 2;
        
        // Ajustement pour éviter de montrer les lignes coupées mais marche pas non plus
        int maxY = lyricsList.getPreferredSize().height - visible.height;
        newY = Math.max(0, Math.min(newY, maxY));
        
        Rectangle target = new Rectangle(0, newY, 10, visible.height);
        lyricsList.scrollRectToVisible(target);
    }
}

    private void updateCurrentLyric(double currentTimeInSeconds) {
    int newIndex = -1;
    for (int i = 0; i < lyricsModel.getSize(); i++) {
        LyricLine line = lyricsModel.getElementAt(i);
        if (line.time <= currentTimeInSeconds) {
            newIndex = i;
        } else {
            break;
        }
    }
    
    if (newIndex != currentLyricIndex) {
        currentLyricIndex = newIndex;
        lyricsList.repaint();
        centerCurrentLyric();
    }
}
    
    private void createPlayerPanel() {
    playerPanel = new JPanel(new BorderLayout(0, 0));
    playerPanel.setBackground(DARK_GRAY);
    playerPanel.setPreferredSize(new Dimension(getWidth(), 100));
    playerPanel.setBorder(new EmptyBorder(8, 24, 8, 24));

    // ZONE GAUCHE
    JPanel leftPanel = new JPanel(new BorderLayout(8, 0));
    leftPanel.setBackground(DARK_GRAY);
    leftPanel.setPreferredSize(new Dimension(240, 80));

    currentPlayerCoverLabel = new JLabel(defaultCoverIcon);
    currentPlayerCoverLabel.setPreferredSize(new Dimension(64, 64));
    leftPanel.add(currentPlayerCoverLabel, BorderLayout.WEST);

    JPanel textPanel = new JPanel();
    textPanel.setLayout(new BoxLayout(textPanel, BoxLayout.Y_AXIS));
    textPanel.setBackground(DARK_GRAY);

    currentPlayerSongLabel = new MiniMarqueeLabel("Aucune lecture", 180);
    currentPlayerSongLabel.setForeground(WHITE);
    currentPlayerSongLabel.setFont(new Font("Segoe UI Emoji", Font.BOLD, 14));
    currentPlayerSongLabel.setAlignmentX(Component.LEFT_ALIGNMENT);

    currentPlayerArtistLabel = new MiniMarqueeLabel("", 180);
    currentPlayerArtistLabel.setForeground(LIGHT_GRAY);
    currentPlayerArtistLabel.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 12));
    currentPlayerArtistLabel.setAlignmentX(Component.LEFT_ALIGNMENT);

    textPanel.add(Box.createVerticalGlue());
    textPanel.add(currentPlayerSongLabel);
    textPanel.add(Box.createVerticalStrut(4));
    textPanel.add(currentPlayerArtistLabel);
    textPanel.add(Box.createVerticalGlue());
    leftPanel.add(textPanel, BorderLayout.CENTER);

    // ZONE CENTRALE
    JPanel centerPanel = new JPanel();
    centerPanel.setLayout(new BoxLayout(centerPanel, BoxLayout.Y_AXIS));
    centerPanel.setBackground(DARK_GRAY);

    // Boutons de contrôle, rendre animé un jour si on a le temps hein
    JPanel controlPanel = new JPanel(new FlowLayout(FlowLayout.CENTER, 8, 0));
    controlPanel.setBackground(DARK_GRAY);

    shuffleButton = createIconButton("Shuffle.png", "Lecture aléatoire", 32, 32);
    shuffleButton.addActionListener(e -> toggleShuffle());
    controlPanel.add(shuffleButton);

    JButton prevButton = createIconButton("PreviousTrack.png", "Piste précédente", 32, 32);
    prevButton.addActionListener(e -> previousSong());
    controlPanel.add(prevButton);

    playPauseButton = new JButton(pauseIcon);
    playPauseButton.setToolTipText("Lecture/Pause");
    playPauseButton.setBorderPainted(false);
    playPauseButton.setFocusPainted(false);
    playPauseButton.setContentAreaFilled(false);
    playPauseButton.setCursor(new Cursor(Cursor.HAND_CURSOR));
    playPauseButton.addActionListener(e -> togglePlayPause());
    controlPanel.add(playPauseButton);

    JButton nextButton = createIconButton("NextTrack.png", "Piste suivante", 32, 32);
    nextButton.addActionListener(e -> nextSong());
    controlPanel.add(nextButton);

    repeatButton = createIconButton("Repeat.png", "Activer la répétition", 32, 32);
    repeatButton.addActionListener(e -> toggleRepeat());
    controlPanel.add(repeatButton);

    // Barre de progression, à moderniser et à rendre plus jolie
    JPanel progressPanel = new JPanel(new BorderLayout());
    progressPanel.setBackground(DARK_GRAY);
    progressPanel.setBorder(new EmptyBorder(8, 0, 0, 0));

    currentTimeLabel = new JLabel("0:00");
    currentTimeLabel.setForeground(LIGHT_GRAY);
    currentTimeLabel.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 11));

    totalTimeLabel = new JLabel("0:00");
    totalTimeLabel.setForeground(LIGHT_GRAY);
    totalTimeLabel.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 11));

    progressSlider = new JSlider(0, 100, 0);
    progressSlider.setBackground(DARK_GRAY);
    progressSlider.setUI(new ModernSliderUI(progressSlider));

    progressSlider.addMouseListener(new MouseAdapter() {
    @Override
    public void mousePressed(MouseEvent e) { 
        sliderDragging = true; 
    }
    
    @Override
    public void mouseReleased(MouseEvent e) {
        sliderDragging = false;
        // Ajout pour VLCJ
        mediaPlayerComponent.mediaPlayer().controls().setTime(progressSlider.getValue() * 1000L);
    }
});

//ChangeListener pour la mise à jour en temps réel
progressSlider.addChangeListener(e -> {
    if (sliderDragging) {
        currentTimeLabel.setText(formatTime(progressSlider.getValue()));
    }
});

    progressPanel.add(currentTimeLabel, BorderLayout.WEST);
    progressPanel.add(progressSlider, BorderLayout.CENTER);
    progressPanel.add(totalTimeLabel, BorderLayout.EAST);

    centerPanel.add(controlPanel);
    centerPanel.add(progressPanel);

    // ZONE DROITE
    JPanel rightPanel = new JPanel(new BorderLayout());
    rightPanel.setBackground(DARK_GRAY);
    rightPanel.setBorder(new EmptyBorder(0, 0, 20, 0)); // Ajustement vertical

    JPanel buttonContainer = new JPanel(new FlowLayout(FlowLayout.RIGHT, 8, 0));
    buttonContainer.setBackground(DARK_GRAY);

    JButton videoButton = createIconButton("Infos.png", "Informations de la musique", 24, 24);
    videoButton.addActionListener(e -> toggleRightPanel());
    buttonContainer.add(videoButton);


    JButton lyricsButton = createIconButton("Lyrics.png", "Afficher les paroles", 24, 24);
    lyricsButton.addActionListener(e -> {
        if (!lyricsModel.isEmpty()) {
            LyricsDialog dialog = new LyricsDialog(
                lyricsModel, 
                currentLyricIndex,
                () -> mediaPlayerComponent.mediaPlayer().status().time() / 1000.0
            );
            dialog.setVisible(true);
        } else {
            JOptionPane.showMessageDialog(
                Beartify.this, 
                "Aucune parole disponible pour cette chanson", 
                "Paroles", 
                JOptionPane.INFORMATION_MESSAGE
            );
        }   
    });
    buttonContainer.add(lyricsButton); 

    JButton queueButton = createIconButton("List.png", "File d'attente", 24, 24);
    buttonContainer.add(queueButton);

    JButton deviceButton = createIconButton("Connect.png", "Périphérique de sortie audio", 24, 24);
    deviceButton.addActionListener(e -> showAudioDevices());
    buttonContainer.add(deviceButton);

    volumeIcon = new JLabel();
    updateVolumeIcon(50);
    volumeIcon.setCursor(new Cursor(Cursor.HAND_CURSOR));
    volumeIcon.addMouseListener(new MouseAdapter() {
        @Override
        public void mouseClicked(MouseEvent e) {
            isMuted = !isMuted;
            if (isMuted) {
                lastVolume = volumeSlider.getValue();
                volumeSlider.setValue(0);
                mediaPlayerComponent.mediaPlayer().audio().setVolume(0); // AJOUT
            } else {
                volumeSlider.setValue(lastVolume);
                mediaPlayerComponent.mediaPlayer().audio().setVolume(lastVolume); // AJOUT
            }
            updateVolumeIcon(volumeSlider.getValue());
        }
    });
    buttonContainer.add(volumeIcon);

    volumeSlider = new JSlider(0, 100, 50);
    volumeSlider.setBackground(DARK_GRAY);
    volumeSlider.setPreferredSize(new Dimension(80, 20));
    volumeSlider.setUI(new ModernSliderUI(volumeSlider));
    volumeSlider.addChangeListener(e -> {
        int value = volumeSlider.getValue();
        updateVolumeIcon(value);
        mediaPlayerComponent.mediaPlayer().audio().setVolume(value); 
    });
    buttonContainer.add(volumeSlider);

    JButton fullscreenButton = createIconButton("fullscreen.png", "Plein écran", 24, 24);
    fullscreenButton.addActionListener(e -> toggleFullscreen());
    buttonContainer.add(fullscreenButton);

    rightPanel.add(buttonContainer, BorderLayout.SOUTH);

    // ASSEMBLAGE FINAL
    playerPanel.add(leftPanel, BorderLayout.WEST);
    playerPanel.add(centerPanel, BorderLayout.CENTER);
    playerPanel.add(rightPanel, BorderLayout.EAST);
}

    private void updateVolumeIcon(int volume) {
    String iconName;
    if (volume == 0 || isMuted) {
        iconName = "VolumeMute.png";
    } else if (volume < 33) {
        iconName = "Volume1.png";
    } else if (volume < 66) {
        iconName = "Volume2.png";
    } else {
        iconName = "Volume3.png";
    }
    
    String fullPath = "pictures/" + iconName;
    File iconFile = new File(fullPath);
    
    if (iconFile.exists()) {
        volumeIcon.setIcon(createIcon(fullPath, 24, 24));
    } else {
        // Fallback si le fichier n'existe pas
        BufferedImage img = new BufferedImage(24, 24, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2d = img.createGraphics();
        g2d.setColor(MEDIUM_GRAY);
        g2d.fillRect(0, 0, 24, 24);
        g2d.setColor(WHITE);
        g2d.drawString("♪", 6, 18);
        g2d.dispose();
        volumeIcon.setIcon(new ImageIcon(img));
    }
}

// Méthode utilitaire pour créer des icones
private ImageIcon createIcon(String path, int width, int height) {
    try {
        File file = new File(path);
        if (!file.exists()) {
            return createDefaultIcon(width, height); // Icone de secours
        }
        BufferedImage original = ImageIO.read(file);
        if (original == null) {
            return createDefaultIcon(width, height);
        }
        Image scaled = original.getScaledInstance(width, height, Image.SCALE_SMOOTH);
        return new ImageIcon(scaled);
    } catch (Exception e) {
        return createDefaultIcon(width, height);
    }
}

// Crée une icone par défaut si l'image est manquante
private ImageIcon createDefaultIcon(int width, int height) {
    BufferedImage img = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g2d = img.createGraphics();
    g2d.setColor(MEDIUM_GRAY);
    g2d.fillRect(0, 0, width, height);
    g2d.setColor(LIGHT_GRAY);
    g2d.drawString("🎵", width/2 - 8, height/2 + 5);
    g2d.dispose();
    return new ImageIcon(img);
}

    private void toggleFullscreen() {
    GraphicsDevice gd = GraphicsEnvironment.getLocalGraphicsEnvironment().getDefaultScreenDevice();
    
    if (gd.getFullScreenWindow() == null) {
        // Passe en plein écran
        dispose();
        setUndecorated(true);
        gd.setFullScreenWindow(this);
        validate();
    } else {
        // Quitte le plein écran
        gd.setFullScreenWindow(null);
        dispose();
        setUndecorated(false);
        setVisible(true);
    }
}

    private void showAudioDevices() {
    deviceComboBox.removeAllItems();
    deviceMap.clear();
    
    java.util.List<AudioDevice> devices = mediaPlayerComponent.mediaPlayer().audio().outputDevices();
    for (AudioDevice device : devices) {
        deviceComboBox.addItem(device.getLongName());
        deviceMap.put(device.getLongName(), device.getDeviceId());
    }

    int result = JOptionPane.showConfirmDialog(this, deviceComboBox, "Choisir un périphérique audio", JOptionPane.OK_CANCEL_OPTION);
    if (result == JOptionPane.OK_OPTION) {
        String selectedDescription = (String) deviceComboBox.getSelectedItem();
        String deviceId = deviceMap.get(selectedDescription);
        
        // Défini directement le périphérique (ça marche pas je hais Java ce langage de merde)
        String outputModule = System.getProperty("os.name").toLowerCase().contains("win") 
                                ? "directsound" 
                                : "alsa";
        mediaPlayerComponent.mediaPlayer().audio().setOutputDevice(outputModule, deviceId);
        
        audioOutputDevice = deviceId;
        JOptionPane.showMessageDialog(this, "Périphérique défini : " + selectedDescription);
    }
}

private void recreateMediaPlayerWithNewDevice(String deviceId) {
    // Sauvegarde l'état actuel
    Song currentSong = getCurrentSong();
    boolean wasPlaying = isPlaying;
    float position = 0;
    String outputModule = System.getProperty("os.name").toLowerCase().contains("win") 
                            ? "directsound" 
                            : "alsa";
    mediaPlayerComponent.mediaPlayer().audio().setOutputDevice(outputModule, deviceId);
    
    if (mediaPlayerComponent != null && mediaPlayerComponent.mediaPlayer().media().isValid()) {
        position = mediaPlayerComponent.mediaPlayer().status().position();
    }
    
    // Détruis l'ancien lecteur
    mediaPlayerComponent.mediaPlayer().release();
    mediaPlayerComponent = null;
    
    // Recrée le lecteur avec la nouvelle configuration
    mediaPlayerComponent = new EmbeddedMediaPlayerComponent();
    
    // Restaure la lecture si nécessaire
    if (currentSong != null) {
        // Met à jour l'interface pour le nouveau lecteur
        videoPanel.removeAll();
        videoPanel.add(mediaPlayerComponent, BorderLayout.CENTER);
        videoPanel.revalidate();
        videoPanel.repaint();
        
        // Rejoue la chanson
        playSong(currentSongIndex);
        
        // Restaure la position
        mediaPlayerComponent.mediaPlayer().controls().setPosition(position);
        
        // Restaure l'état de lecture
        if (wasPlaying) {
            mediaPlayerComponent.mediaPlayer().controls().play();
        } else {
            mediaPlayerComponent.mediaPlayer().controls().pause();
        }
    }
}

    private JButton createModernMenuButton(String text) {
        JButton button = new JButton(text);
        button.setAlignmentX(Component.LEFT_ALIGNMENT);
        button.setBackground(BLACK);
        button.setOpaque(true);
        button.setContentAreaFilled(true);
        button.setForeground(WHITE);
        button.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 14));
        button.setBorder(new EmptyBorder(12, 16, 12, 16));
        button.setFocusPainted(false);
        button.setHorizontalAlignment(SwingConstants.LEFT);
        button.setCursor(new Cursor(Cursor.HAND_CURSOR));
        button.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseEntered(MouseEvent e) { button.setBackground(HOVER); }
            @Override
            public void mouseExited(MouseEvent e) { button.setBackground(BLACK); }
        });
        return button;
    }

    private JButton createModernControlButton(String text, int size) {
        JButton button = new JButton(text);
        button.setBackground(WHITE);
        button.setForeground(BLACK);
        button.setFont(new Font("Segoe UI Emoji", Font.PLAIN, size == 48 ? 22 : 16));
        button.setPreferredSize(new Dimension(size, size));
        button.setBorder(null);
        button.setFocusPainted(false);
        button.setCursor(new Cursor(Cursor.HAND_CURSOR));
        button.setOpaque(true);
        button.setContentAreaFilled(true);
        button.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseEntered(MouseEvent e) { button.setBackground(LIGHT_GRAY); }
            @Override
            public void mouseExited(MouseEvent e) { button.setBackground(WHITE); }
        });
        return button;
    }

    private void setupLyricsPanel() {
    lyricsList.addComponentListener(new ComponentAdapter() {
        @Override
        public void componentResized(ComponentEvent e) {
            centerCurrentLyric(); // Recentre la ligne active
        }
    });
}

    private void setupEventListeners() {
        volumeSlider.addChangeListener(e -> {
        int value = volumeSlider.getValue();
        mediaPlayerComponent.mediaPlayer().audio().setVolume(value);
        updateVolumeIcon(value);
    });
}

    private void updateSongDisplay() {
        updateSongDisplay(currentPlaylist);
    }

    private void updateSongDisplay(java.util.List<Song> list) {
        songsPanel.removeAll();
        displayedSongs = list; 
        if (list != null) {
            for (int i = 0; i < list.size(); i++) {
                Song song = list.get(i);
                JPanel songPanel = createModernSongPanel(song, i);
                songsPanel.add(songPanel);
                songsPanel.add(Box.createVerticalStrut(4));
            }
        }
        songsPanel.revalidate();
        songsPanel.repaint();
    }

    private JPanel createModernSongPanel(Song song, int index) {
    JPanel panel = new JPanel();
    panel.setLayout(new BoxLayout(panel, BoxLayout.X_AXIS));
    panel.setBackground(DARK_GRAY);
    panel.setBorder(new EmptyBorder(4, 0, 4, 0));
    panel.setMaximumSize(new Dimension(480, 64));
    panel.setPreferredSize(new Dimension(480, 64));
    panel.setCursor(new Cursor(Cursor.HAND_CURSOR));

    // Numéro
    JLabel numberLabel = new JLabel(String.valueOf(index + 1), SwingConstants.CENTER);
    numberLabel.setForeground(LIGHT_GRAY);
    numberLabel.setFont(new Font("Segoe UI Emoji", Font.BOLD, 22));
    numberLabel.setPreferredSize(new Dimension(48, 64)); 
    numberLabel.setHorizontalAlignment(SwingConstants.CENTER);
    numberLabel.setVerticalAlignment(SwingConstants.CENTER);
    panel.add(numberLabel);

    panel.add(Box.createHorizontalStrut(8));

    // Cover
    JLabel coverLabel = new JLabel(getRoundedImageIcon(getCoverForSong(song, 48, 48), 48, 48, 12));
    coverLabel.setPreferredSize(new Dimension(48, 48));
    coverLabel.setMaximumSize(new Dimension(48, 48));
    coverLabel.setMinimumSize(new Dimension(48, 48));
    coverLabel.setAlignmentY(Component.CENTER_ALIGNMENT);
    panel.add(coverLabel);

    panel.add(Box.createHorizontalStrut(12));

    // Infos (titre + artiste/album, vertical dans un panel voir le hinner HTML qui me sert à rien au final)
    JPanel infoPanel = new JPanel();
    infoPanel.setLayout(new BoxLayout(infoPanel, BoxLayout.Y_AXIS));
    infoPanel.setBackground(DARK_GRAY);
    infoPanel.setPreferredSize(new Dimension(260, 48));
    infoPanel.setMaximumSize(new Dimension(260, 48));
    infoPanel.setMinimumSize(new Dimension(260, 48));
    infoPanel.setAlignmentY(Component.CENTER_ALIGNMENT);

    JLabel titleLabel = new JLabel("<html><div style='width:230px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;'>"
        + escapeHtml(song.getTitle()) + "</div></html>");
    titleLabel.setForeground(WHITE);
    titleLabel.setFont(new Font("Segoe UI Emoji", Font.BOLD, 14));
    titleLabel.setPreferredSize(new Dimension(250, 22));
    titleLabel.setToolTipText(song.getTitle());
    infoPanel.add(titleLabel);

    JLabel artistAlbumLabel = new JLabel("<html><div style='width:230px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;'>"
        + escapeHtml(song.getArtist() + " • " + song.getAlbum()) + "</div></html>");
    artistAlbumLabel.setForeground(LIGHT_GRAY);
    artistAlbumLabel.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 12));
    artistAlbumLabel.setPreferredSize(new Dimension(250, 18));
    artistAlbumLabel.setToolTipText(song.getArtist() + " • " + song.getAlbum());
    infoPanel.add(artistAlbumLabel);

    titleLabel.setToolTipText(song.getTitle());
    artistAlbumLabel.setToolTipText(song.getArtist() + " • " + song.getAlbum());

    panel.add(infoPanel);

    panel.add(Box.createHorizontalGlue());

    JButton addToPlaylistBtn = new JButton("➕");
    addToPlaylistBtn.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 16));
    addToPlaylistBtn.setBackground(BLACK);
    addToPlaylistBtn.setForeground(WHITE);
    addToPlaylistBtn.setBorder(new EmptyBorder(2, 6, 2, 6));
    addToPlaylistBtn.setFocusPainted(false);
    addToPlaylistBtn.setAlignmentY(Component.CENTER_ALIGNMENT);
    addToPlaylistBtn.setToolTipText("Ajouter à une playlist");
    addToPlaylistBtn.addActionListener(e -> addToPlaylist(song));
    panel.add(addToPlaylistBtn);

    panel.add(Box.createHorizontalStrut(4));

    // Bouton favori
    JButton favBtn = new JButton(song.isFavorite() ? "💚" : "🤍");
    favBtn.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 16));
    favBtn.setBackground(BLACK);
    favBtn.setForeground(WHITE);
    favBtn.setBorder(new EmptyBorder(2, 6, 2, 6));
    favBtn.setFocusPainted(false);
    favBtn.setAlignmentY(Component.CENTER_ALIGNMENT);
    favBtn.addActionListener(e -> {
        song.setFavorite(!song.isFavorite());
        favBtn.setText(song.isFavorite() ? "💚" : "🤍");
        if (song.isFavorite()) playlists.get("Mes favoris").add(song);
        else playlists.get("Mes favoris").remove(song);
    });
    panel.add(favBtn);

    
    JLabel durationLabel = new JLabel(song.getDurationString());
    durationLabel.setForeground(LIGHT_GRAY);
    durationLabel.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 12));
    durationLabel.setPreferredSize(new Dimension(40, 64));
    durationLabel.setHorizontalAlignment(SwingConstants.RIGHT);
    durationLabel.setVerticalAlignment(SwingConstants.CENTER);
    durationLabel.setAlignmentY(Component.CENTER_ALIGNMENT);
    panel.add(durationLabel);

    panel.addMouseListener(new java.awt.event.MouseAdapter() {
        @Override
        public void mouseEntered(MouseEvent e) {
            setPanelAndChildrenBg(panel, MEDIUM_GRAY);
        }
        @Override
        public void mouseExited(MouseEvent e) {
            if (currentSongIndex == index && currentPlaylist == displayedSongs) {
                setPanelAndChildrenBg(panel, MEDIUM_GRAY);
            } else {
                setPanelAndChildrenBg(panel, DARK_GRAY);
            }
        }
        @Override
        public void mouseClicked(MouseEvent e) {
            if (e.getClickCount() == 2) {
                playSongFromDisplayed(index);
                setPanelAndChildrenBg(panel, MEDIUM_GRAY);
            }
        }
    });
    return panel;
    }


    private void playSongFromDisplayed(int index) {
    if (displayedSongs == null || displayedSongs.isEmpty() || index < 0 || index >= displayedSongs.size()) return;
    Song song = displayedSongs.get(index);
    currentPlaylist = displayedSongs;
    currentSongIndex = index;
    updateCurrentSongInfo(song);
    playSong(currentSongIndex); 
    isPlaying = true;
    playPauseButton.setIcon(pauseIcon);
}

    private String escapeHtml(String s) {
    return s.replace("&", "&")
            .replace("<", "<")
            .replace(">", ">")
            .replace("\"", "\"")
            .replace("'", "'");
}

    private ImageIcon getCoverForSong(Song song, int w, int h) {
    try {
        File songFile = new File(song.getFilePath());
        File coverDir = new File(songFile.getParentFile(), "cover");
        String baseName = songFile.getName().replaceAll("(?i)\\.mp3$", "");
        File coverFile = new File(coverDir, baseName + ".jpg");
        if (!coverFile.exists()) coverFile = new File(coverDir, baseName + ".png");
        
        if (coverFile.exists()) {
            BufferedImage original = ImageIO.read(coverFile);
            if (original != null) {
                Image scaled = original.getScaledInstance(w, h, Image.SCALE_SMOOTH);
                return new ImageIcon(scaled);
            }
        }
    } catch (Exception e) {
        e.printStackTrace();
    }
    // Retourne toujours l'icône par défaut si échec
    return defaultCoverIcon != null ? defaultCoverIcon : createDefaultIcon(w, h);
}

    private void addToPlaylist(Song song) {
        java.util.List<String> userPlaylists = new ArrayList<>();
        for (int i = 0; i < playlistModel.size(); i++) {
            String name = playlistModel.getElementAt(i).replaceAll("<[^>]*>", "");
            if (!name.equals("Toutes les musiques") && !name.equals("Mes favoris") && !name.contains("Créer une nouvelle playlist")) {
                userPlaylists.add(playlistModel.getElementAt(i));
            }
        }
        if (userPlaylists.isEmpty()) {
            JOptionPane.showMessageDialog(this, "Aucune playlist personnalisée disponible.", "Info", JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        String playlistName = (String) JOptionPane.showInputDialog(this, "Ajouter à la playlist :", "Playlists",
                JOptionPane.PLAIN_MESSAGE, null, userPlaylists.toArray(), null);
        if (playlistName != null) {
            String cleanName = playlistName.replaceAll("<[^>]*>", "");
            if (playlists.containsKey(cleanName)) {
                java.util.List<Song> pl = playlists.get(cleanName);
                if (!pl.contains(song)) pl.add(song); // Ajout sans doublon mais marche pas dans la barre de progression
                updateSongDisplay();
            }
        }
    }

    private void playSong(int songIndex) {
    if (currentPlaylist == null || currentPlaylist.isEmpty() || songIndex < 0 || songIndex >= currentPlaylist.size()) return;
    Song song = currentPlaylist.get(songIndex);
    currentSongIndex = songIndex;
    updateCurrentSongInfo(song);
    progressSlider.setValue(0);
    sliderDragging = false;
    
    // Arrête le lecteur actuel
    stopMediaPlayer();
    
    // Prépare le média
    File audioFile = new File(song.getFilePath());
    String mediaPath = audioFile.getAbsolutePath();
    
      // Configure le lecteur
    mediaPlayerComponent.mediaPlayer().media().play(mediaPath);
    mediaPlayerComponent.mediaPlayer().audio().setVolume(volumeSlider.getValue());
    
    if (audioOutputDevice != null) {
        String outputModule = System.getProperty("os.name").toLowerCase().contains("win") 
                                ? "directsound" 
                                : "alsa";
        mediaPlayerComponent.mediaPlayer().audio().setOutputDevice(outputModule, audioOutputDevice);
    }
    // Configure le volume
    mediaPlayerComponent.mediaPlayer().audio().setVolume(volumeSlider.getValue());
    
    // Applique la configuration audio
    if (audioOutputDevice != null) {
        String outputModule = System.getProperty("os.name").toLowerCase().contains("win") 
                                ? "directsound" 
                                : "alsa";
        mediaPlayerComponent.mediaPlayer().audio().setOutputDevice(outputModule, audioOutputDevice);
    }
    
    // Configure le volume
    mediaPlayerComponent.mediaPlayer().audio().setVolume(volumeSlider.getValue());
    
    // Démarre la lecture
    mediaPlayerComponent.mediaPlayer().controls().play();
    isPlaying = true;
    playPauseButton.setIcon(pauseIcon);
    
    // Mise à jour de la progression
    new javax.swing.Timer(100, e -> {
    if (mediaPlayerComponent.mediaPlayer().status().isPlaying()) {
        long time = mediaPlayerComponent.mediaPlayer().status().time();
        int seconds = (int)(time / 1000);
        if (!sliderDragging) {
            progressSlider.setValue(seconds);
            currentTimeLabel.setText(formatTime(seconds));
            updateLyricsDisplay(); // Actualisation des paroles
        }
    }
}).start();
    
    // Gestion de la fin de la piste
    mediaPlayerComponent.mediaPlayer().events().addMediaPlayerEventListener(new MediaPlayerEventAdapter() {
    @Override
    public void finished(uk.co.caprica.vlcj.player.base.MediaPlayer mediaPlayer) {
        SwingUtilities.invokeLater(() -> {
            if (isRepeatMode) {
                playSong(currentSongIndex);
            } else {
                nextSong();
            }
        });
    }
});
}

    private void updateLyricsDisplay() {
    if (mediaPlayerComponent != null && mediaPlayerComponent.mediaPlayer().status().isPlaying()) {
        double currentTime = mediaPlayerComponent.mediaPlayer().status().time() / 1000.0;
        int newIndex = -1;
        DefaultListModel<LyricLine> model = lyricsManager.getModel();
        
        for (int i = 0; i < model.getSize(); i++) {
            LyricLine line = model.getElementAt(i);
            if (line.time <= currentTime) {
                newIndex = i;
            }
        }
        
        lyricsManager.setCurrentIndex(newIndex);
    }
    }

    private void checkAudioOutput() {
    java.util.List<AudioDevice> devices = mediaPlayerComponent.mediaPlayer().audio().outputDevices();
    if (!devices.isEmpty()) {
        // Sélectionne le premier périphérique par défaut
        String outputModule = System.getProperty("os.name").toLowerCase().contains("win") 
                                ? "directsound" 
                                : "alsa";
        mediaPlayerComponent.mediaPlayer().audio().setOutputDevice(outputModule, devices.get(0).getDeviceId());
    }
}

    private void updatePlaybackProgress() {
    if (mediaPlayerComponent != null && mediaPlayerComponent.mediaPlayer().status().isPlaying()) {
        long time = mediaPlayerComponent.mediaPlayer().status().time();
        int seconds = (int)(time / 1000);
        if (!sliderDragging) {
            progressSlider.setValue(seconds);
            currentTimeLabel.setText(formatTime(seconds));
            updateCurrentLyric(seconds);
        }
    }
}

    private void updateCurrentSongInfo(Song song) {
    currentSongLabel.setText(escapeHtml(song.getTitle()));
    currentArtistLabel.setText(escapeHtml(song.getArtist() + " • " + song.getAlbum()));
    currentCoverLabel.setIcon(getRoundedImageIcon(getCoverForSong(song, 320, 320), 320, 320, 32));
    totalTimeLabel.setText(song.getDurationString());
    currentTimeLabel.setText("0:00");
    loadLyricsForSong(song);

    currentPlayerSongLabel.setText(escapeHtml(song.getTitle()));
    currentPlayerArtistLabel.setText(escapeHtml(song.getArtist()));
    ImageIcon playerCover = getCoverForSong(song, 64, 64);
    currentPlayerCoverLabel.setIcon(getRoundedImageIcon(playerCover, 64, 64, 16));

    ImageIcon cover = getCoverForSong(song, 320, 320);
    if (cover == null) cover = defaultCoverIcon;
    currentCoverLabel.setIcon(getRoundedImageIcon(cover, 320, 320, 32));
    
    progressSlider.setMaximum(song.getDuration());
    progressSlider.setValue(0);
    progressSlider.addChangeListener(e -> {
    if (sliderDragging) {
        currentTimeLabel.setText(formatTime(progressSlider.getValue()));
    }
});

    File audioFile = new File(song.getFilePath());
    File parentDir = audioFile.getParentFile();
    File videosDir = new File(parentDir, "videos");
    String songName = audioFile.getName().replaceAll("(?i)\\.mp3$", "");
    File videoFile = new File(videosDir, songName + ".mp4");
    
    if (videoFile.exists()) {
        // Réinitialise complètement le lecteur
        mediaPlayerComponent.mediaPlayer().controls().stop();
        mediaPlayerComponent.mediaPlayer().media().play(videoFile.getAbsolutePath());
        
        // Redimensionne pour s'adapter au panneau
        mediaPlayerComponent.mediaPlayer().video().setScale(0.6f);
        
        videoPanel.setVisible(true);
    } else {
        mediaPlayerComponent.mediaPlayer().controls().stop();
        videoPanel.setVisible(false);
    }
    
    if (videoFile.exists()) {
        mediaPlayerComponent.mediaPlayer().media().prepare(videoFile.getAbsolutePath());
        if (audioOutputDevice != null) {
            String outputModule = System.getProperty("os.name").toLowerCase().contains("win") 
                                    ? "directsound" 
                                    : "alsa";
            mediaPlayerComponent.mediaPlayer().audio().setOutputDevice(outputModule, audioOutputDevice);
        }

    if (audioOutputDevice != null) {
    String outputModule = System.getProperty("os.name").toLowerCase().contains("win") 
                            ? "waveout" 
                            : "alsa";
    mediaPlayerComponent.mediaPlayer().audio().setOutputDevice(outputModule, audioOutputDevice);
}
        videoPanel.setVisible(true);
    } else {
        mediaPlayerComponent.mediaPlayer().controls().stop();
        videoPanel.setVisible(false); // Cache le lecteur vidéo
    }

    updateVinylWidgetContent();
    currentDominantColor = getDominantColor(getCoverForSong(song, 320, 320));
    if (currentDominantColor == null) {
        currentDominantColor = DARK_GRAY;
    }
    rightPanel.repaint();
    playerPanel.revalidate();
    playerPanel.repaint();
}

    public class LyricsManager {
    private final DefaultListModel<LyricLine> model = new DefaultListModel<>();
    private int currentIndex = -1;
    private final List<LyricsUpdateListener> listeners = new ArrayList<>();
    private JList<LyricLine> lyricsList;

    public LyricsManager() {
        this.lyricsList = null;
    }

    public void setLyricsList(JList<LyricLine> list) {
        this.lyricsList = list;
    }

    public DefaultListModel<LyricLine> getModel() {
        return model;
    }

    public void setLyrics(List<LyricLine> lines) {
        model.clear();
        lines.forEach(model::addElement);
        setCurrentIndex(-1);
    }

    public void setCurrentIndex(int index) {
        if (index != currentIndex) {
            currentIndex = index;
            updateDisplay();
            notifyLyricsUpdated();
        }
    }

    public int getCurrentIndex() {
        return currentIndex;
    }

    public void resetIndex() {
        setCurrentIndex(-1);
    }

    private void updateDisplay() {
        if (lyricsList != null && currentIndex >= 0) {
            Rectangle cellRect = lyricsList.getCellBounds(currentIndex, currentIndex);
            if (cellRect != null) {
                lyricsList.scrollRectToVisible(cellRect);
                lyricsList.repaint();
            }
        }
    }

    public void registerListener(LyricsUpdateListener listener) {
        listeners.add(listener);
    }

    public void unregisterListener(LyricsUpdateListener listener) {
        listeners.remove(listener);
    }

    private void notifyLyricsUpdated() {
        for (LyricsUpdateListener listener : listeners) {
            listener.onLyricsUpdated(model, currentIndex);
        }
    }

    public interface LyricsUpdateListener {
        void onLyricsUpdated(DefaultListModel<LyricLine> model, int currentIndex);
    }
}
    
    private void togglePlayPause() {
    if (mediaPlayerComponent.mediaPlayer().status().isPlaying()) {
        mediaPlayerComponent.mediaPlayer().controls().pause();
        isPlaying = false;
        playPauseButton.setIcon(playIcon);
    } else {
        mediaPlayerComponent.mediaPlayer().controls().play();
        isPlaying = true;
        playPauseButton.setIcon(pauseIcon);
    }
}
    private void nextSong() {
        if (currentPlaylist == null || currentPlaylist.isEmpty()) return;
        int nextIndex = isShuffleMode ? getRandomSongIndex() : (currentSongIndex + 1) % currentPlaylist.size();
        playSong(nextIndex);
    }

    private void previousSong() {
        if (currentPlaylist == null || currentPlaylist.isEmpty()) return;
        int prevIndex = isShuffleMode ? getRandomSongIndex() : (currentSongIndex - 1 + currentPlaylist.size()) % currentPlaylist.size();
        playSong(prevIndex);
    }

    private int getRandomSongIndex() {
        Random random = new Random();
        return random.nextInt(currentPlaylist.size());
    }

    private void toggleShuffle() {
        isShuffleMode = !isShuffleMode;
        shuffleButton.setBackground(isShuffleMode ? GREEN : WHITE);
        shuffleButton.setForeground(isShuffleMode ? WHITE : BLACK);
    }

    private void toggleRepeat() {
        isRepeatMode = !isRepeatMode;
        repeatButton.setBackground(isRepeatMode ? GREEN : WHITE);
        repeatButton.setForeground(isRepeatMode ? WHITE : BLACK);
    }

    private void toggleRightPanel() {
        boolean visible = !rightPanel.isVisible();
        rightPanel.setVisible(visible);
        revalidate();
        repaint();
    }

    private class ModernPlaylistCellRenderer extends DefaultListCellRenderer {
        @Override
        public Component getListCellRendererComponent(JList<?> list, Object value, int index, boolean isSelected, boolean cellHasFocus) {
            super.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus);
            setBackground(isSelected ? MEDIUM_GRAY : BLACK);
            setForeground(WHITE);
            setHorizontalAlignment(SwingConstants.CENTER);
            setBorder(new EmptyBorder(8, 16, 8, 16));
            setOpaque(true);
            setFont(new Font("Segoe UI Emoji", Font.PLAIN, 14));
            return this;
        }
    }
    private class ModernScrollBarUI extends javax.swing.plaf.basic.BasicScrollBarUI {
        @Override protected void configureScrollBarColors() { thumbColor = GREEN; trackColor = BLACK; }
        @Override protected JButton createDecreaseButton(int orientation) { return createZeroButton(); }
        @Override protected JButton createIncreaseButton(int orientation) { return createZeroButton(); }
        private JButton createZeroButton() {
            JButton button = new JButton();
            button.setPreferredSize(new Dimension(0, 0));
            button.setMinimumSize(new Dimension(0, 0));
            button.setMaximumSize(new Dimension(0, 0));
            return button;
        }
    }
    private class ModernSliderUI extends javax.swing.plaf.basic.BasicSliderUI {
        public ModernSliderUI(JSlider slider) { super(slider); }
        @Override public void paintTrack(Graphics g) {
            Graphics2D g2d = (Graphics2D) g;
            g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            Rectangle trackBounds = trackRect;
            int cy = (trackBounds.height / 2) - 2;
            int cw = trackBounds.width;
            g2d.setColor(MEDIUM_GRAY);
            g2d.fillRoundRect(trackBounds.x, trackBounds.y + cy, cw, 4, 4, 4);
            int progressWidth = (int) ((double) slider.getValue() / slider.getMaximum() * cw);
            g2d.setColor(GREEN);
            g2d.fillRoundRect(trackBounds.x, trackBounds.y + cy, progressWidth, 4, 4, 4);
        }
        @Override public void paintThumb(Graphics g) {
            Graphics2D g2d = (Graphics2D) g;
            g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            Rectangle thumbBounds = thumbRect;
            g2d.setColor(Color.WHITE);
            g2d.fillOval(thumbBounds.x, thumbBounds.y, thumbBounds.width, thumbBounds.height);
        }
    }

    private static class MiniMarqueeLabel extends JLabel implements ActionListener {
    private int offset = 0;
    private javax.swing.Timer timer;
    private int textWidth = 0;
    private boolean scrolling = false;
    private final int maxWidth;
    private String pendingText = ""; // Stocke le texte temporairement

    public MiniMarqueeLabel(String text, int maxWidth) {
        super(text);
        this.maxWidth = maxWidth;
        this.pendingText = text; // Conserve le texte initial
        setPreferredSize(new Dimension(maxWidth, 20));
        // Retarde l'initialisation du scrolling
    }

    @Override
    public void setText(String text) {
        super.setText(text);
        this.pendingText = text;
        checkScrolling();
    }

    @Override
    public void setFont(Font font) {
        super.setFont(font);
        // Relance le calcul quand la police est définie
        checkScrolling();
    }

    private void checkScrolling() {
        if (getFont() == null) return; // Sort si police non prête
        
        FontMetrics fm = getFontMetrics(getFont());
        if (pendingText != null) {
            super.setText(pendingText); // Applique le texte
            pendingText = null;
        }
        
        textWidth = fm.stringWidth(getText());
        offset = 0;
        
        if (timer != null) {
            timer.stop();
            timer = null;
        }
        
        scrolling = textWidth > maxWidth;
        
        if (scrolling) {
            timer = new javax.swing.Timer(30, this);
            timer.start();
        }
    }

    @Override
    protected void paintComponent(Graphics g) {
        if (scrolling) {
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setColor(getForeground());
            FontMetrics fm = g2.getFontMetrics(getFont());
            int y = (getHeight() + fm.getAscent() - fm.getDescent()) / 2;
            g2.drawString(getText(), -offset, y);
            g2.dispose();
        } else {
            super.paintComponent(g);
        }
    }

    @Override
    public void actionPerformed(ActionEvent e) {
        if (scrolling) {
            offset += 1;
            if (offset > textWidth + 20) offset = 0;
            repaint();
        }
    }
}

    // Bordures arrondies pour la barre de recherche, penser à modifier la couleur de fond de la barre de recherche si besoin
    private static class RoundedBorder extends LineBorder {
        private final int radius;
        public RoundedBorder(Color color, int radius, int thickness) {
            super(color, thickness, true);
            this.radius = radius;
        }
        @Override
        public void paintBorder(Component c, Graphics g, int x, int y, int width, int height) {
            Graphics2D g2 = (Graphics2D) g;
            g2.setColor(lineColor);
            g2.setStroke(new BasicStroke(thickness));
            g2.drawRoundRect(x, y, width - 1, height - 1, radius, radius);
        }
    }

        private void stopMediaPlayer() {
    if (mediaPlayerComponent != null) {
        mediaPlayerComponent.mediaPlayer().controls().stop();
    }
}



    private void selectMusicDirectory() {
        JFileChooser folderChooser = new JFileChooser();
        folderChooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        folderChooser.setDialogTitle("Sélectionner le dossier contenant vos musiques");
        String userHome = System.getProperty("user.home");
        File defaultMusicDir = new File(userHome, "Music");
        if (defaultMusicDir.exists()) folderChooser.setCurrentDirectory(defaultMusicDir);
        int result = folderChooser.showOpenDialog(this);
        if (result == JFileChooser.APPROVE_OPTION) {
            musicDirectory = folderChooser.getSelectedFile();
            loadMusicFromDirectory();
        }
    }
    
    private void loadMusicFromDirectory() {
        if (musicDirectory == null) return;
        Set<Song> uniqueSongs = new LinkedHashSet<>();
        playlists.clear();
        playlistModel.clear();
        playlistModel.addElement("Toutes les musiques");
        playlistModel.addElement("Mes favoris");
        playlists.put("Toutes les musiques", new ArrayList<>());
        playlists.put("Mes favoris", new ArrayList<>());
        scanDirectory(musicDirectory, uniqueSongs);
        allSongs.clear();
        allSongs.addAll(uniqueSongs);
        playlists.get("Toutes les musiques").addAll(allSongs);
        updateSongDisplay();
        JOptionPane.showMessageDialog(this, allSongs.size() + " musiques chargées depuis " + musicDirectory.getName(), "Chargement terminé", JOptionPane.INFORMATION_MESSAGE);
        for (java.util.List<Song> pl : playlists.values()) {
            Set<Song> set = new LinkedHashSet<>(pl);
            pl.clear();
            pl.addAll(set);
        }
    }

    private void scanDirectory(File directory, Set<Song> uniqueSongs) {
        File[] files = directory.listFiles();
        if (files == null) return;
        java.util.List<Song> folderSongs = new ArrayList<>();
        for (File file : files) {
            if (file.isDirectory()) scanDirectory(file, uniqueSongs);
            else if (file.getName().toLowerCase().endsWith(".mp3")) {
                Song song = createSongFromFile(file);
                if (song != null) {
                    uniqueSongs.add(song);
                    if (!folderSongs.contains(song)) folderSongs.add(song);
                }
            }
        }
        if (!folderSongs.isEmpty() && !directory.equals(musicDirectory)) {
            String playlistName = directory.getName();
            playlistModel.addElement(playlistName);
            List<Song> uniqueFolderSongs = new ArrayList<>(new LinkedHashSet<>(folderSongs));
            playlists.put(playlistName, uniqueFolderSongs);
        }
    }

    private Song createSongFromFile(File file) {
        try {
            String title = file.getName().replace(".mp3", "");
            String artist = "Artiste inconnu";
            String album = "Album inconnu";
            ImageIcon cover = defaultCoverIcon;
            int duration = 0;
            try {
                AudioFile audioFile = AudioFileIO.read(file);
                Tag tag = audioFile.getTag();
                if (tag != null) {
                    String t = tag.getFirst(FieldKey.TITLE);
                    if (t != null && !t.isEmpty()) title = t;
                    String a = tag.getFirst(FieldKey.ARTIST);
                    if (a != null && !a.isEmpty()) artist = a;
                    String al = tag.getFirst(FieldKey.ALBUM);
                    if (al != null && !al.isEmpty()) album = al;
                }
                duration = audioFile.getAudioHeader().getTrackLength();
            } catch (Exception e) { }
            return new Song(title, artist, album, file.getAbsolutePath(), cover, duration);
        } catch (Exception e) { return null; }
    }
    private void addMusicFiles() {
        JFileChooser fileChooser = new JFileChooser();
        fileChooser.setFileFilter(new FileNameExtensionFilter("Fichiers MP3", "mp3"));
        fileChooser.setMultiSelectionEnabled(true);
        if (musicDirectory != null) fileChooser.setCurrentDirectory(musicDirectory);
        int result = fileChooser.showOpenDialog(this);
        if (result == JFileChooser.APPROVE_OPTION) {
            File[] files = fileChooser.getSelectedFiles();
            for (File file : files) {
                Song song = createSongFromFile(file);
                if (song != null && !allSongs.contains(song)) allSongs.add(song);
            }
            updateSongDisplay();
        }
    }
    private void createNewPlaylist() {
        String playlistName = JOptionPane.showInputDialog(this, "Nom de la nouvelle playlist (max 20 caractères):", "Nouvelle Playlist", JOptionPane.PLAIN_MESSAGE);
        if (playlistName != null) {
            playlistName = playlistName.trim();
            if (!playlistName.isEmpty() && playlistName.length() <= 20) {
                playlistModel.addElement(playlistName);
                playlists.put(playlistName, new ArrayList<>());
            } else if (playlistName.length() > 20) {
                JOptionPane.showMessageDialog(this, "Le nom de la playlist ne doit pas dépasser 20 caractères.", "Erreur", JOptionPane.ERROR_MESSAGE);
            }
        }
    }
    private void loadPlaylist(String playlistName) {
        currentPlaylist = playlists.get(playlistName);
        updateSongDisplay();
    }

    public static class Song {
        private String title;
        private String artist;
        private String album;
        private ImageIcon cover;
        private int duration;
        private boolean favorite = false;
        private String filePath;

    public Song(String title, String artist, String album, String filePath, ImageIcon cover, int duration) {
        this.title = title;
        this.artist = artist;
        this.album = album;
        this.filePath = filePath; 
        this.cover = cover;
        this.duration = duration;
    }
        
        public String getTitle() { return title; }
        public String getArtist() { return artist; }
        public String getAlbum() { return album; }
        public String getFilePath() { return filePath; }
        public ImageIcon getCover() { return cover; }
        public int getDuration() { return duration; }
        public String getDurationString() {
            int min = duration / 60;
            int sec = duration % 60;
            return min + ":" + (sec < 10 ? "0" : "") + sec;
        }
        public boolean isFavorite() { return favorite; }
        public void setFavorite(boolean fav) { this.favorite = fav; }
        @Override
        public String toString() { return title + " - " + artist; }

        @Override
        public boolean equals(Object obj) {
            if (this == obj) return true;
            if (obj == null || getClass() != obj.getClass()) return false;
            Song other = (Song) obj;
        return filePath != null && filePath.equals(other.filePath);
    }

    @Override
    public int hashCode() {
        return filePath != null ? filePath.hashCode() : 0;
    }
}

    private static class WidgetMarqueeLabel extends JLabel implements ActionListener {
    private int offset = 0;
    private int speed = 30; // Vitesse de défilement (en ms)
    private javax.swing.Timer timer;
    private int textWidth = 0;
    private boolean scrolling = false;
    private int availableWidth;

    public WidgetMarqueeLabel(String text, Font font, Color color) {
        super(text);
        setFont(font);
        setForeground(color);
        setHorizontalAlignment(SwingConstants.LEFT);
        setPreferredSize(new Dimension(120, 16));
        this.availableWidth = 120;
        setOpaque(false); 
    }

    public void setAvailableWidth(int width) {
        this.availableWidth = width;
        checkScrollingNeeded();
    }

    @Override
    public void setText(String text) {
        super.setText(text);
        checkScrollingNeeded();
    }

    private void checkScrollingNeeded() {
        if (getFont() == null) return;
        
        FontMetrics fm = getFontMetrics(getFont());
        textWidth = fm.stringWidth(getText());
        offset = 0;
        
        if (timer != null) {
            timer.stop();
            timer = null;
        }
        
        scrolling = textWidth > availableWidth;
        
        if (scrolling) {
            timer = new javax.swing.Timer(speed, this);
            timer.start();
        }
        
        repaint();
    }

    @Override
    protected void paintComponent(Graphics g) {
        if (scrolling) {
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setColor(getForeground());
            FontMetrics fm = getFontMetrics(getFont());
            int y = (getHeight() + fm.getAscent() - fm.getDescent()) / 2;
            
            // Dessine le texte défilant mais marche pas trop bien
            g2.drawString(getText(), -offset, y);
            g2.drawString(getText(), textWidth - offset + 16, y); // Boucle
            
            g2.dispose();
        } else {
            super.paintComponent(g);
        }
    }

    @Override
    public void actionPerformed(ActionEvent e) {
        if (scrolling) {
            offset += 1;
            if (offset > textWidth + 16) {
                offset = 0;
            }
            repaint();
        }
    }

    public void stopScrolling() {
        if (timer != null) {
            timer.stop();
        }
    }
}
        private void showVinylWidget() {
    if (vinylWidget != null && vinylWidget.isVisible()) {final ImageIcon coverIcon = null;
        updateVinylWidgetContent();
        return;
    }

    //Déclare btnSize et vinylSize
    int btnSize = 24;
    int widgetH = 64;
    int vinylSize = 48;
    int widgetW = vinylSize + 4 + 5 * (btnSize + 4) + 8 + 120; 

    //Récupère la cover et la couleur dominante
    Song current = getCurrentSong();
    final ImageIcon coverIcon = (current != null) ? getCoverForSong(current, vinylSize, vinylSize) : defaultCoverIcon;
    final Color dominantColor = getDominantColor(coverIcon);

    // Charge l'image du vinyle
    ImageIcon tmpVinylImg = null;
        File vinylFile = new File("pictures/vinyle.png");
        if (vinylFile.exists()) {
            try {
                BufferedImage original = ImageIO.read(vinylFile);
                Image scaled = original.getScaledInstance(vinylSize, vinylSize, Image.SCALE_SMOOTH);
                BufferedImage resized = new BufferedImage(vinylSize, vinylSize, BufferedImage.TYPE_INT_ARGB);
                Graphics2D g2d = resized.createGraphics();
                g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g2d.drawImage(scaled, 0, 0, null);
                g2d.dispose();
                tmpVinylImg = new ImageIcon(resized);
            } catch (Exception ex) {
                tmpVinylImg = null;
            }
        } else {
            tmpVinylImg = null;
    }

final ImageIcon vinylImg = tmpVinylImg;
    System.out.println("Vinyl file exists: " + vinylFile.exists());
    System.out.println("Vinyl file path: " + vinylFile.getAbsolutePath());
    System.out.println("vinylImg is null? " + (vinylImg == null));

    vinylWidget = new JDialog(this, false);
    vinylWidget.setUndecorated(true);
    vinylWidget.setBackground(new Color(0,0,0,0));
    vinylWidget.setLayout(new BorderLayout());
    vinylWidget.setAlwaysOnTop(true);
    vinylWidget.setSize(widgetW, widgetH);


// Panel du widget 
JPanel widgetPanel = new JPanel() {
    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        int arc = widgetH;
        g2.setColor(dominantColor != null ? dominantColor : new Color(0, 0, 0, 200));
        g2.fillRoundRect(0, 0, getWidth(), getHeight(), arc, arc);
        g2.dispose();
        super.paintComponent(g);
    }
};
widgetPanel.setOpaque(false);
widgetPanel.setLayout(null);
widgetPanel.setPreferredSize(new Dimension(widgetW, widgetH));

// Vinyle collé à gauche
JLabel vinylLabel = new JLabel();
vinylLabel.setBounds(4, 4, vinylSize, vinylSize);

// Animation de rotation
final double[] angle = {0};
javax.swing.Timer vinylTimer = new javax.swing.Timer(30, e -> {
    if (isPlaying) { 
        angle[0] += 0.025;
        vinylLabel.setIcon(getVinylWithCoverIcon(vinylImg, coverIcon, vinylSize, angle[0]));
    }
});
vinylTimer.start();
vinylLabel.setIcon(getVinylWithCoverIcon(vinylImg, coverIcon, vinylSize, 0));
vinylLabel.setOpaque(false);
widgetPanel.add(vinylLabel);

// Titre juste après le vinyle
String songTitle = getCurrentSong() != null ? getCurrentSong().getTitle() : "";
int titleWidth = widgetW - vinylSize - 16 - 5*(btnSize + 4); // Calcul de la largeur disponible
WidgetMarqueeLabel titleLabel = new WidgetMarqueeLabel(
    songTitle, 
    new Font("Segoe UI Emoji", Font.BOLD, 13), 
    Color.WHITE
);
titleLabel.setOpaque(false);
titleLabel.setAvailableWidth(titleWidth); // Défini la largeur disponible
titleLabel.setBounds(vinylSize + 8, 6, titleWidth, 16);
titleLabel.setHorizontalAlignment(SwingConstants.LEFT);
widgetPanel.add(titleLabel);
titleLabel.setFont(new Font("Segoe UI Emoji", Font.BOLD, 13));
titleLabel.setForeground(Color.WHITE);
titleLabel.setOpaque(false);
titleLabel.setBounds(vinylSize + 8, 6, widgetW - vinylSize - 16, 16);
titleLabel.setHorizontalAlignment(SwingConstants.LEFT);
System.out.println("Titre: " + songTitle);
System.out.println("Cover: " + (coverIcon == defaultCoverIcon ? "default" : "custom"));
widgetPanel.add(titleLabel);

// Boutons collés à droite du titre
int y = 28;
int x = vinylSize + 8;

JButton shuffleBtn = createModernControlButton("🔀", btnSize);
shuffleBtn.setBounds(x, y, btnSize, btnSize);
shuffleBtn.addActionListener(e -> toggleShuffle());

JButton prevBtn = createModernControlButton("⏮", btnSize);
prevBtn.setBounds(x + (btnSize + 4), y, btnSize, btnSize);
prevBtn.addActionListener(e -> previousSong());

JButton playBtn = createModernControlButton(isPlaying ? "⏸" : "▶", btnSize + 4);
playBtn.setBounds(x + 2 * (btnSize + 4), y - 2, btnSize + 4, btnSize + 4);
playBtn.addActionListener(e -> {
    togglePlayPause();
    playBtn.setText(isPlaying ? "⏸" : "▶");
    if (isPlaying) vinylTimer.start(); else vinylTimer.stop();
});


JButton nextBtn = createModernControlButton("⏭", btnSize);
nextBtn.setBounds(x + 3 * (btnSize + 4) + 4, y, btnSize, btnSize);
nextBtn.addActionListener(e -> nextSong());

JButton repeatBtn = createModernControlButton("🔁", btnSize);
repeatBtn.setBounds(x + 4 * (btnSize + 4) + 4, y, btnSize, btnSize);
repeatBtn.addActionListener(e -> toggleRepeat());

widgetPanel.add(shuffleBtn);
widgetPanel.add(prevBtn);
widgetPanel.add(playBtn);
widgetPanel.add(nextBtn);
widgetPanel.add(repeatBtn);

// Drag & drop (repris d'un repo GitHub et oui chuis un voleur hihi)
final Point[] mouseDownCompCoords = {null};
widgetPanel.addMouseListener(new MouseAdapter() {
    public void mousePressed(MouseEvent e) {
        mouseDownCompCoords[0] = e.getPoint();
    }
});
widgetPanel.addMouseMotionListener(new MouseMotionAdapter() {
    public void mouseDragged(MouseEvent e) {
        Point currCoords = e.getLocationOnScreen();
        vinylWidget.setLocation(currCoords.x - mouseDownCompCoords[0].x, currCoords.y - mouseDownCompCoords[0].y);
    }
});

vinylWidget.add(widgetPanel, BorderLayout.CENTER);
vinylWidget.setSize(widgetW, widgetH);
vinylWidget.setVisible(true);
        vinylWidget.setLocationRelativeTo(this);
        vinylWidget.setFocusableWindowState(false);
        vinylWidget.setDefaultCloseOperation(JDialog.DISPOSE_ON_CLOSE);
        vinylWidget.addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent e) {
                vinylTimer.stop();
                vinylWidget.dispose();
                vinylWidget = null;
            }
        });
        vinylWidget.setFocusable(true);
        vinylWidget.requestFocusInWindow();
        vinylWidget.setFocusableWindowState(false);
        vinylWidget.addKeyListener(new KeyAdapter() {
            @Override
            public void keyPressed(KeyEvent e) {
                if (e.getKeyCode() == KeyEvent.VK_ESCAPE) {
                    vinylTimer.stop();
                    vinylWidget.dispose();
                    vinylWidget = null;
                } else if (e.getKeyCode() == KeyEvent.VK_SPACE) {
                    togglePlayPause();
                    playBtn.setText(isPlaying ? "⏸" : "▶");
                    if (isPlaying) vinylTimer.start(); else vinylTimer.stop();
                } else if (e.getKeyCode() == KeyEvent.VK_LEFT) {
                    previousSong();
                } else if (e.getKeyCode() == KeyEvent.VK_RIGHT) {
                    nextSong();
                }
            }
        });
    }

    private Point lastVinylWidgetLocation = null;

    private void updateVinylWidgetContent() {
        if (vinylWidget != null && vinylWidget.isVisible()) {
            lastVinylWidgetLocation = vinylWidget.getLocation();
            vinylWidget.dispose();
            vinylWidget = null;
            showVinylWidget();
            if (lastVinylWidgetLocation != null && vinylWidget != null) {
                final ImageIcon coverIcon = null;
                vinylWidget.setLocation(lastVinylWidgetLocation);
            }
        }
    }

    private Song getCurrentSong() {
    if (currentPlaylist != null && currentSongIndex >= 0 && currentSongIndex < currentPlaylist.size()) {
        return currentPlaylist.get(currentSongIndex);
    }
    return null;
}

    private Color getDominantColor(ImageIcon icon) {
        if (icon == null || icon.getIconWidth() <= 0 || icon.getIconHeight() <= 0) return new Color(0,0,0,200);
        BufferedImage img = new BufferedImage(icon.getIconWidth(), icon.getIconHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g2d = img.createGraphics();
        g2d.drawImage(icon.getImage(), 0, 0, null);
        g2d.dispose();

        int r=0, g=0, b=0, count=0;
        for (int x = 0; x < img.getWidth(); x+=4) {
            for (int y = 0; y < img.getHeight(); y+=4) {
                int rgb = img.getRGB(x, y);
                Color c = new Color(rgb);
                r += c.getRed();
                g += c.getGreen();
                b += c.getBlue();
                count++;
            }
        }
        if (count == 0) return new Color(0,0,0,200);
        return
        new Color(r/count, g/count, b/count, 200);
    }


    private ImageIcon getVinylWithCoverIcon(ImageIcon vinyl, ImageIcon cover, int size, double angle) {
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2 = img.createGraphics();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

        // Rotation du vinyle
        if (vinyl != null) {
            g2.rotate(angle, size / 2.0, size / 2.0);
            g2.drawImage(vinyl.getImage(), 0, 0, size, size, null);
            g2.rotate(-angle, size / 2.0, size / 2.0);
        } else {
            g2.setColor(Color.BLACK);
            g2.fillOval(0, 0, size, size);
        }
        // Rotation de la cover (optionnel, sinon elle reste fixe mais ça fait plus stylé)
        if (cover != null) {
            int coverSize = (int)(size * 0.56);
            int coverX = (size - coverSize) / 2;
            int coverY = (size - coverSize) / 2;
            g2.rotate(angle, size / 2.0, size / 2.0); // pour tourner la cover aussi
            g2.setClip(new java.awt.geom.Ellipse2D.Float(coverX, coverY, coverSize, coverSize));
            g2.drawImage(cover.getImage(), coverX, coverY, coverSize, coverSize, null);
            g2.setClip(null);
            g2.rotate(-angle, size / 2.0, size / 2.0);
        }

        g2.dispose();
        return new ImageIcon(img);
    }
    public static void main(String[] args) {
        try {
            UIManager.setLookAndFeel(UIManager.getCrossPlatformLookAndFeelClassName());
        } catch (Exception e) { e.printStackTrace(); }
        SwingUtilities.invokeLater(() -> new Beartify().setVisible(true));
    }
}



