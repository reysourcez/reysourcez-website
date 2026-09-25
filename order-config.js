/* QR Listing Creator — customer page settings (order-config.js) — VERSION 1.4 (2026-09-25)
   Plain values only: edit, save, upload. No other file needs to change.
   v1.4: themeTestMode defaults to false now that sellers have a real Theme picker (Settings tab, v1.6) —
   flip it back to true on your own machine any time you want to preview every theme quickly. */
window.ORDER_CONFIG = {
  themeTestMode: false,     // true = show the theme test dropdown (bottom-left), handy for previewing themes yourself.
  defaultTheme: 'classic',  // used only for a business that hasn't picked its own theme yet (Settings tab)
  text: { topPicks: '\u2605 Top picks', fullMenu: 'Full menu', shopLayout: 'Shop layout' },
  ads: {
    enabled: true,          // false = hide the banner for every listing, even one with its own slides
    rotateSeconds: 6,       // 0 = no auto-rotate
    slides: [               // shown only for a listing that hasn't set its own slides yet (Settings tab, v1.6). up to 6.
                             // url = https://… or a page on this site (e.g. contact.html); '' = not clickable
      { title: 'Your ad here', text: 'Put your brand in front of hungry customers.', cta: 'Advertise with us', url: 'contact.html', emoji: '\ud83d\udce3', bg: 'linear-gradient(120deg,#C1121F,#F7B32B)', fg: '#ffffff' },
      { title: 'Make your own QR menu', text: 'Free. Set up in minutes.', cta: 'Try it free', url: 'qr-listing-creator.html', emoji: '\ud83d\udcf1', bg: 'linear-gradient(120deg,#1F6F5C,#38A88B)', fg: '#ffffff' }
    ]
  }
};
