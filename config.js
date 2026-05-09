// Coûts fixes mensuels récurrents (hors GPU/R2 déjà trackés par miner)
const FIXED_COSTS = [
  { label: 'Claude Max+',    usd_month: 200 },
  { label: 'Anthropic API',  usd_month:  50 },
  // { label: 'Cloudflare',  usd_month:   0 },
];

// Frais d'inscription on-chain (burn TAO, coût unique par subnet)
// Récupérés via SubtensorModule.Burn au bloc d'inscription de chaque UID.
const REGISTRATION_COSTS = [
  { label: 'Inscription SN85 (UID 251)', tao: 0.0005,  reg_block: 8139796 },
  { label: 'Inscription SN26 (UID 129)', tao: 0.07366, reg_block: 8146550 },
  { label: 'Inscription SN6  (UID 156)', tao: 0.2000,  reg_block: 8145945 },
];

const SUBNETS = [
  {
    type:         'compute',
    netuid:       85,
    name:         'Vidaio',
    description:  'Traitement vidéo AI — Upscaling & Compression',
    uid:          251,
    gpu:          'RTX 5090',
    network:      'finney',
    dashboardUrl: 'http://87.197.110.78:40104',
    statusFile:   './status/sn85.json',
    color:        '#7c3aed',
    accent:       '#a78bfa',
    tags:         ['video', 'AI', 'RunPod'],
  },
  {
    type:         'forecasting',
    netuid:       6,
    name:         'Numinous',
    description:  'Forecasting AI — Prédiction d\'événements binaires',
    uid:          156,
    gpu:          'No GPU',
    network:      'finney',
    dashboardUrl: './sn6.html',
    statusFile:   './status/sn6.json',
    color:        '#6366f1',
    accent:       '#818cf8',
    tags:         ['forecasting', 'Python', 'No GPU'],
  },
  {
    type:         'compute',
    netuid:       26,
    name:         'Perturb',
    description:  'Adversarial Perturbation — Attaques PGD sur EfficientNet-B5',
    uid:          129,
    gpu:          'RTX 3090',
    network:      'finney',
    dashboardUrl: 'http://216.249.100.66:14512',
    statusFile:   './status/sn26.json',
    color:        '#0d9488',
    accent:       '#2dd4bf',
    tags:         ['vision', 'AI', 'RunPod'],
  },
];
