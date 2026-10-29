// La geometria del logo Ronchiverdi per l'avvio animato (vedi lib/avvio.ts).
//
// Ricavata da `public/logo-ronchiverdi-sport.png` (2362 x 1434), non a mano:
//  - la cucitura della pallina e' la linea mediana del tratto bianco dentro il
//    disco, prolungata fino al bordo, ricampionata in 96 punti equidistanti;
//  - le misure sono in unita' di raggio della pallina, con l'origine nel centro
//    della pallina e l'asse y verso il basso (come lo schermo);
//  - le due scritte (`public/avvio/scritta.png`, `public/avvio/sportclub.png`) sono
//    ritagliate dallo stesso file, bianche con trasparenza, per poterle tingere.
// Se il logo cambia, si rifanno da quel file.

/** Larghezza del tratto della cucitura, in raggi della pallina. */
export const SPESSORE_CUCITURA = 0.1257

/** La cucitura vista di fronte, dall'inizio alla fine: [u, v] nel disco di raggio 1. */
export const CUCITURA: readonly (readonly [number, number])[] = [
  [0.509, 0.8657], [0.4689, 0.8504], [0.4289, 0.8348], [0.3951, 0.8087],
  [0.3698, 0.7741], [0.3491, 0.7365], [0.3306, 0.6977], [0.3145, 0.6579],
  [0.3016, 0.617], [0.2923, 0.5751], [0.2867, 0.5325], [0.285, 0.4896],
  [0.2879, 0.4468], [0.295, 0.4045], [0.3064, 0.3631], [0.3226, 0.3234],
  [0.3432, 0.2857], [0.3675, 0.2503], [0.3942, 0.2167], [0.422, 0.184],
  [0.4495, 0.1511], [0.4759, 0.1172], [0.5009, 0.0822], [0.5243, 0.0463],
  [0.5458, 0.0091], [0.5649, -0.0293], [0.5817, -0.0689], [0.5958, -0.1094],
  [0.6067, -0.1509], [0.6143, -0.1932], [0.6184, -0.2359], [0.6185, -0.2788],
  [0.6145, -0.3216], [0.6066, -0.3637], [0.5948, -0.405], [0.579, -0.4449],
  [0.5596, -0.4832], [0.5365, -0.5194], [0.51, -0.5532], [0.481, -0.5848],
  [0.4501, -0.6146], [0.4173, -0.6423], [0.3825, -0.6675], [0.3461, -0.6902],
  [0.3082, -0.7105], [0.269, -0.7279], [0.2288, -0.7428], [0.1876, -0.755],
  [0.1456, -0.764], [0.1032, -0.7703], [0.0604, -0.7738], [0.0174, -0.774],
  [-0.0254, -0.7712], [-0.0681, -0.7664], [-0.1105, -0.76], [-0.1526, -0.7515],
  [-0.1941, -0.7406], [-0.2349, -0.7272], [-0.2749, -0.7114], [-0.3138, -0.6933],
  [-0.3516, -0.673], [-0.3882, -0.6505], [-0.4232, -0.6256], [-0.4564, -0.5984],
  [-0.4878, -0.5692], [-0.5177, -0.5384], [-0.5459, -0.506], [-0.5723, -0.4722],
  [-0.5968, -0.4369], [-0.6197, -0.4006], [-0.6412, -0.3634], [-0.6612, -0.3254],
  [-0.6792, -0.2865], [-0.6955, -0.2467], [-0.7108, -0.2066], [-0.725, -0.1661],
  [-0.7383, -0.1253], [-0.7503, -0.084], [-0.7605, -0.0423], [-0.7694, -0.0003],
  [-0.7776, 0.0418], [-0.7856, 0.084], [-0.7929, 0.1263], [-0.7988, 0.1689],
  [-0.8032, 0.2116], [-0.8071, 0.2543], [-0.811, 0.2971], [-0.8146, 0.3399],
  [-0.8151, 0.3828], [-0.8098, 0.4254], [-0.8007, 0.4673], [-0.7906, 0.5091],
  [-0.7799, 0.5506], [-0.7682, 0.592], [-0.7557, 0.633], [-0.7433, 0.6742],
]

/** Dove stanno le scritte nel logo finito: [x0, y0, x1, y1] in raggi, dal centro della pallina. */
export const SCRITTA = [-3.2851, 1.0302, 3.2203, 2.7365] as const
export const SPORT_CLUB = [-1.1166, 2.6847, 1.0778, 2.9914] as const
