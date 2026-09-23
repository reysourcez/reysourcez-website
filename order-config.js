/* QR Listing Creator — customer page settings (order-config.js) — VERSION 1.3 (2026-09-24)
   Plain values only: edit, save, upload. No other file needs to change. */
window.ORDER_CONFIG = {
  themeTestMode: true,      // true = show the theme test dropdown (bottom-left). Set to false before real customers use the page.
  defaultTheme: 'classic',  // classic, ubereats, doordash, grab, foodpanda, shopeefood, deliveroo, noirgold, starbucks, neo, aurora
  text: { topPicks: '\u2605 Top picks', fullMenu: 'Full menu', shopLayout: 'Shop layout' },
  ads: {
    enabled: true,          // false = hide the banner
    rotateSeconds: 6,       // 0 = no auto-rotate
    slides: [               // up to 6. url = https://… or a page on this site (e.g. contact.html); '' = not clickable
      { title: 'Your ad here', text: 'Put your brand in front of hungry customers.', cta: 'Advertise with us', url: 'contact.html', emoji: '\ud83d\udce3', bg: 'linear-gradient(120deg,#C1121F,#F7B32B)', fg: '#ffffff' },
      { title: 'Make your own QR menu', text: 'Free. Set up in minutes.', cta: 'Try it free', url: 'qr-listing-creator.html', emoji: '\ud83d\udcf1', bg: 'linear-gradient(120deg,#1F6F5C,#38A88B)', fg: '#ffffff' }
    ]
  }
};
