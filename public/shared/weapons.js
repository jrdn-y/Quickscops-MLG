// Sniper rifles, MLG-legal attachments and perks. Shared by server and client.
// Every gun is one shot, one kill under MLG rules; the stats decide handling, not damage.

export const WEAPONS = {
  intervention: { name: 'Intervention', fire: 'bolt', rpm: 46, mag: 5, reserve: 25, reload: [2.6, 3.2], ads: 0.22, hip: 10, recoil: 0.03, move: 0.95, zoom: 4.7, sway: 1 },
  barrett: { name: 'Barrett .50cal', fire: 'semi', rpm: 220, mag: 10, reserve: 30, reload: [3.0, 3.6], ads: 0.3, hip: 10, recoil: 0.05, move: 0.9, zoom: 4.7, sway: 1.3 },
  wa2000: { name: 'WA2000', fire: 'semi', rpm: 260, mag: 6, reserve: 30, reload: [2.7, 3.2], ads: 0.26, hip: 10, recoil: 0.035, move: 0.93, zoom: 4.7, sway: 1.1 },
  m21: { name: 'M21 EBR', fire: 'semi', rpm: 280, mag: 10, reserve: 30, reload: [2.5, 3.0], ads: 0.24, hip: 10, recoil: 0.032, move: 0.95, zoom: 4.2, sway: 1 },
};
export const WEAPON_KEYS = Object.keys(WEAPONS);

export const ATTACH = {
  none: { name: 'None' },
  fmj: { name: 'FMJ', desc: 'Bullets go through thin walls (wallbangs)' },
  extmag: { name: 'Extended Mags', desc: '+50% magazine size', mag: 1.5 },
};

// Commando, Stopping Power, UAV-related and grenade perks are banned in MLG quickscope lobbies.
export const PERKS = [
  { sleight: 'Sleight of Hand — faster reload and faster scope-in', marathon: 'Marathon — unlimited sprint' },
  { lightweight: 'Lightweight — move faster, shoot sooner after sprinting', coldblooded: 'Cold-Blooded — no name tag when enemies aim at you' },
  { steady: 'Steady Aim — tighter no-scope spread', ninja: 'Ninja — silent footsteps' },
];
export const PERK_NAMES = Object.assign({}, ...PERKS.map(t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.split(' — ')[0]]))));

export const LETHALS = { tknife: 'Throwing Knife', none: 'None' };

export const DEFAULT_CLASSES = [
  { name: 'Quickscoper', primary: 'intervention', att: 'fmj', lethal: 'tknife', perks: ['sleight', 'lightweight', 'steady'] },
  { name: 'No-Scoper', primary: 'intervention', att: 'none', lethal: 'tknife', perks: ['sleight', 'lightweight', 'steady'] },
  { name: 'Trickshotter', primary: 'intervention', att: 'fmj', lethal: 'tknife', perks: ['marathon', 'lightweight', 'ninja'] },
  { name: 'Barrett', primary: 'barrett', att: 'extmag', lethal: 'tknife', perks: ['sleight', 'lightweight', 'steady'] },
  { name: 'Semi-Auto', primary: 'm21', att: 'fmj', lethal: 'none', perks: ['sleight', 'coldblooded', 'ninja'] },
];

const pick = (v, list, d) => (list.includes(v) ? v : d);
export function sanitizeLoadout(l) {
  const d = DEFAULT_CLASSES[0];
  if (!l || typeof l !== 'object') return { ...d, perks: [...d.perks] };
  return {
    name: String(l.name || 'Custom').slice(0, 20),
    primary: pick(l.primary, WEAPON_KEYS, d.primary),
    att: pick(l.att, Object.keys(ATTACH), 'none'),
    lethal: pick(l.lethal, Object.keys(LETHALS), 'tknife'),
    perks: PERKS.map((tier, i) => (Array.isArray(l.perks) && tier[l.perks[i]] ? l.perks[i] : Object.keys(tier)[0])),
  };
}

// Final stats for the loadout's sniper with attachment and perks applied.
export function weaponStats(l) {
  const w = WEAPONS[l.primary] || WEAPONS.intervention;
  const a = ATTACH[l.att] || ATTACH.none;
  const sleight = l.perks.includes('sleight');
  return {
    ...w,
    key: l.primary,
    att: l.att,
    interval: 60 / w.rpm,
    mag: Math.round(w.mag * (a.mag || 1)),
    ads: w.ads * (sleight ? 0.8 : 1),
    reload: w.reload.map(r => r * (sleight ? 0.55 : 1)),
    hip: w.hip * (l.perks.includes('steady') ? 0.65 : 1),
    fmj: l.att === 'fmj',
  };
}
