/* Ryuhai - build-time settings.
 * server: the address the app connects to when the player has not typed one in "Server".
 * Put your public server here before building the Android app so players can just install and play, for example:
 *   window.HC_CONFIG = { server: 'ryuhai.onrender.com' };
 * Leave it empty to let players type their own address.
 * (The website needs nothing here: it always uses the server it was opened from.)
 */
/* shopUrl: the always-on copy of the shop (skin list + images) that the game loads every time it opens, so new skins
 * appear even when your computer is off. It is the "raw" address of the GitHub folder the admin page uploads to, ending in "/",
 * for example:  shopUrl: 'https://raw.githubusercontent.com/YourName/ryuhai-skins/main/'
 * The admin page shows the exact address to paste here once the remote is set up. Leave empty to use only the game server. */
window.HC_CONFIG = { server: '', shopUrl: 'https://raw.githubusercontent.com/Bixie5/Ryuhai-skins/main/' };
