// Mattoncini comuni alle scene dei certificati: email, riga voucher. Dati fittizi, classi vere dell'app.
export const MAIL_CSS = `
  .mail { background: #fdfaf3; border-radius: 14px; overflow: hidden; color: #17170f; }
  .mail-testa { background: #1c1c18; color: #f6efde; padding: 16px 28px; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 34px; letter-spacing: .02em; }
  .mail-corpo { padding: 22px 30px 26px; font-size: 28px; line-height: 1.45; }
  .mail-ogg { font-weight: 600; font-size: 30px; margin: 0 0 14px; }
  .mail-corpo p { margin: 0 0 12px; }
  .mail-cod { font-family: 'Jost', sans-serif; font-weight: 600; font-size: 74px; letter-spacing: .14em; color: #8b6c14; margin: 4px 0 4px; font-variant-numeric: tabular-nums; }
  .mail-et { font-size: 28px; letter-spacing: .16em; text-transform: uppercase; color: #8b6c14; margin: 0 0 4px; }
`;
export const chipOro = (id, testo, st = '') => `<span id="${id}" style="display:inline-block;background:#1c1c18;color:#efbf48;border-radius:999px;padding:10px 26px;font-weight:600;font-size:30px;${st}">${testo}</span>`;
