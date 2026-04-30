/**
 * japan-utils.js – Japonsko info: kurz JPY/CZK, phrasebook, etiquette, kontakty, tech.
 */

/* ── Data ────────────────────────────────────────────────────── */

const PHRASES = [
  // Základní
  { cz: 'Dobrý den',              jp: 'こんにちは',              romaji: 'Konnichiwa',                  cat: 'basic' },
  { cz: 'Dobré ráno',             jp: 'おはようございます',       romaji: 'Ohayō gozaimasu',             cat: 'basic' },
  { cz: 'Dobrý večer',            jp: 'こんばんは',              romaji: 'Konbanwa',                    cat: 'basic' },
  { cz: 'Děkuji',                 jp: 'ありがとうございます',     romaji: 'Arigatō gozaimasu',           cat: 'basic' },
  { cz: 'Děkuji moc',             jp: 'どうもありがとう',         romaji: 'Dōmo arigatō',                cat: 'basic' },
  { cz: 'Prosím',                 jp: 'お願いします',             romaji: 'Onegaishimasu',               cat: 'basic' },
  { cz: 'Promiňte',               jp: 'すみません',               romaji: 'Sumimasen',                   cat: 'basic' },
  { cz: 'Ano',                    jp: 'はい',                    romaji: 'Hai',                         cat: 'basic' },
  { cz: 'Ne',                     jp: 'いいえ',                  romaji: 'Iie',                         cat: 'basic' },
  { cz: 'Na shledanou',           jp: 'さようなら',              romaji: 'Sayōnara',                    cat: 'basic' },

  // Ptaní se
  { cz: 'Mluvíte anglicky?',      jp: '英語を話せますか？',        romaji: 'Eigo o hanasemasu ka?',       cat: 'questions' },
  { cz: 'Nerozumím',              jp: '分かりません',             romaji: 'Wakarimasen',                 cat: 'questions' },
  { cz: 'Jak se to řekne?',       jp: 'これは何といいますか？',    romaji: 'Kore wa nan to iimasu ka?',   cat: 'questions' },
  { cz: 'Kolik to stojí?',        jp: 'いくらですか？',           romaji: 'Ikura desu ka?',              cat: 'questions' },
  { cz: 'Kde je toaleta?',        jp: 'トイレはどこですか？',      romaji: 'Toire wa doko desu ka?',      cat: 'questions' },
  { cz: 'Můžete mi pomoct?',      jp: '助けてもらえますか？',      romaji: 'Tasukete moraemasu ka?',      cat: 'questions' },

  // Restaurace
  { cz: 'Stůl pro 2',             jp: '2人です',                 romaji: 'Futari desu',                 cat: 'food' },
  { cz: 'Menu prosím',            jp: 'メニューお願いします',      romaji: 'Menyū onegaishimasu',         cat: 'food' },
  { cz: 'Dobrou chuť',            jp: 'いただきます',             romaji: 'Itadakimasu',                 cat: 'food' },
  { cz: 'Bylo to vynikající',     jp: 'おいしかったです',          romaji: 'Oishikatta desu',             cat: 'food' },
  { cz: 'Účet prosím',            jp: 'お会計お願いします',        romaji: 'Okaikei onegaishimasu',       cat: 'food' },
  { cz: 'Voda prosím',            jp: 'お水お願いします',          romaji: 'Omizu onegaishimasu',         cat: 'food' },
  { cz: 'Bez masa',               jp: '肉なしで',                 romaji: 'Niku nashi de',               cat: 'food' },
  { cz: 'Bez ryby',               jp: '魚なしで',                 romaji: 'Sakana nashi de',             cat: 'food' },

  // Doprava
  { cz: 'Jaká stanice?',          jp: '何駅ですか？',             romaji: 'Nani eki desu ka?',           cat: 'transport' },
  { cz: 'Jeden lístek do…',       jp: '〜まで一枚お願いします',    romaji: '…made ichimai onegaishimasu', cat: 'transport' },
  { cz: 'Vlak do Tokia',          jp: '東京行きの電車',            romaji: 'Tōkyō yuki no densha',        cat: 'transport' },
  { cz: 'Taxi prosím',            jp: 'タクシーをお願いします',    romaji: 'Takushī o onegaishimasu',     cat: 'transport' },

  // Hotel
  { cz: 'Mám rezervaci',          jp: '予約があります',            romaji: 'Yoyaku ga arimasu',           cat: 'hotel' },
  { cz: 'Check-in',               jp: 'チェックインお願いします',  romaji: 'Chekkuin onegaishimasu',      cat: 'hotel' },
  { cz: 'Wi-Fi heslo?',           jp: 'Wi-Fiのパスワードは？',    romaji: 'Wi-Fi no pasuwādo wa?',       cat: 'hotel' },
  { cz: 'V kolik je snídaně?',    jp: '朝食は何時ですか？',        romaji: 'Chōshoku wa nanji desu ka?',  cat: 'hotel' },

  // Nakupování
  { cz: 'Mohu si vyzkoušet?',     jp: '試着できますか？',          romaji: 'Shichaku dekimasu ka?',       cat: 'shopping' },
  { cz: 'Větší velikost',         jp: '大きいサイズ',              romaji: 'Ōkii saizu',                  cat: 'shopping' },
  { cz: 'Menší velikost',         jp: '小さいサイズ',              romaji: 'Chiisai saizu',               cat: 'shopping' },
  { cz: 'Karta nebo hotovost?',   jp: 'カードか現金ですか？',      romaji: 'Kādo ka genkin desu ka?',     cat: 'shopping' },

  // Nouze
  { cz: 'Pomoc!',                 jp: '助けて！',                  romaji: 'Tasukete!',                   cat: 'emergency' },
  { cz: 'Zavolejte policii',      jp: '警察を呼んでください',       romaji: 'Keisatsu o yonde kudasai',    cat: 'emergency' },
  { cz: 'Zavolejte ambulanci',    jp: '救急車を呼んでください',      romaji: 'Kyūkyūsha o yonde kudasai',   cat: 'emergency' },
  { cz: 'Není mi dobře',          jp: '気分が悪いです',             romaji: 'Kibun ga warui desu',         cat: 'emergency' },
  { cz: 'Bolí mě hlava',          jp: '頭が痛いです',              romaji: 'Atama ga itai desu',          cat: 'emergency' },
  { cz: 'Bolí mě břicho',         jp: 'お腹が痛いです',            romaji: 'Onaka ga itai desu',          cat: 'emergency' },

  // Cesta
  { cz: 'Kde je…?',               jp: '〜はどこですか？',           romaji: '…wa doko desu ka?',           cat: 'directions' },
  { cz: 'Doprava',                jp: '右',                        romaji: 'Migi',                        cat: 'directions' },
  { cz: 'Doleva',                 jp: '左',                        romaji: 'Hidari',                      cat: 'directions' },
  { cz: 'Rovně',                  jp: 'まっすぐ',                  romaji: 'Massugu',                     cat: 'directions' },
  { cz: 'Blízko',                 jp: '近い',                      romaji: 'Chikai',                      cat: 'directions' },
  { cz: 'Daleko',                 jp: '遠い',                      romaji: 'Tōi',                         cat: 'directions' },

  // Čísla
  { cz: '1',      jp: '一',  romaji: 'Ichi',        cat: 'numbers' },
  { cz: '2',      jp: '二',  romaji: 'Ni',          cat: 'numbers' },
  { cz: '3',      jp: '三',  romaji: 'San',         cat: 'numbers' },
  { cz: '4',      jp: '四',  romaji: 'Yon / Shi',   cat: 'numbers' },
  { cz: '5',      jp: '五',  romaji: 'Go',          cat: 'numbers' },
  { cz: '10',     jp: '十',  romaji: 'Jū',          cat: 'numbers' },
  { cz: '100',    jp: '百',  romaji: 'Hyaku',       cat: 'numbers' },
  { cz: '1 000',  jp: '千',  romaji: 'Sen',         cat: 'numbers' },
  { cz: '10 000', jp: '万',  romaji: 'Man',         cat: 'numbers' },
];

const PHRASE_CATS = {
  basic:      { label: 'Základní',    icon: '👋' },
  questions:  { label: 'Ptaní se',    icon: '❓' },
  food:       { label: 'Restaurace',  icon: '🍱' },
  transport:  { label: 'Doprava',     icon: '🚇' },
  hotel:      { label: 'Hotel',       icon: '🏨' },
  shopping:   { label: 'Nakupování',  icon: '🛍️' },
  emergency:  { label: 'Nouze',       icon: '🆘' },
  directions: { label: 'Cesta',       icon: '🧭' },
  numbers:    { label: 'Čísla',       icon: '🔢' },
};

const ETIQUETTE = [
  { icon: '🙇', title: 'Úklon (ojigi)',    text: 'Při pozdravu se ukloň. Hluboký úklon = víc respektu. Lehký úklon stačí v běžných situacích.' },
  { icon: '👞', title: 'Boty',             text: 'V chrámech, domech, ryokanu a restauracích s tatami se zouvají boty. Dej je úhledně směřující ven.' },
  { icon: '🥢', title: 'Hůlky',            text: 'NIKDY nezapichuj hůlky do rýže (pohřební rituál). Nedávej jídlo z hůlek na hůlky.' },
  { icon: '🚇', title: 'V MHD',            text: 'Buď tichý. Mobil na vibrace. Nejez ve vlaku (kromě shinkansenu). Stůj vpravo na eskalátoru (Tokio).' },
  { icon: '💴', title: 'Spropitné',        text: 'NEDÁVEJ spropitné! V Japonsku je to považováno za urážku. Ceny jsou vždy finální.' },
  { icon: '🤧', title: 'Smrkání',          text: 'Nesmrkej veřejně — velmi neslušné. Jdi na toaletu nebo stranou.' },
  { icon: '🚬', title: 'Kouření',          text: 'Pouze v označených místech. Kouření na ulici je obvykle zakázáno (i v Tokiu).' },
  { icon: '📷', title: 'Focení',           text: 'NEFOTOGRAFUJ gejše ani lidi bez svolení. V chrámech může být focení zakázáno.' },
  { icon: '🗣️', title: 'Hlasitost',       text: 'Mluv tiše ve veřejných prostorech, hlavně v MHD. Hlasité telefonování je velmi neslušné.' },
  { icon: '👥', title: 'Fronta',           text: 'Vždy se postav do fronty. Žádné předbíhání. I u vlaku stůj na vyznačeném místě.' },
];

const CONTACTS = [
  { icon: '🚓', name: 'Policie',                            number: '110',            desc: 'Kriminalita, ztráta, krádež' },
  { icon: '🚑', name: 'Ambulance / Hasiči',                 number: '119',            desc: 'Lékařská pomoc, požár' },
  { icon: '🇨🇿', name: 'Česká ambasáda Tokio',             number: '+81 3 3400 8122', desc: 'Hirakawacho 2-16-14, Chiyoda-ku' },
  { icon: '🆘', name: 'Japan Helpline (24/7)',               number: '0570 000 911',   desc: 'Anglicky pro turisty' },
  { icon: '🏥', name: 'St. Luke Intl. Hospital (Tokio)',    number: '+81 3 3541 5151', desc: 'Anglicky mluvící lékaři' },
];

const TECH = [
  {
    icon: '🔌', title: 'Elektrika',
    items: [
      'Napětí: 100 V (CZ má 230 V!)',
      'Frekvence: 50 Hz (Tokio) / 60 Hz (Osaka)',
      'Zástrčka: Type A (2 ploché kolíky)',
      'Potřebuješ adaptér Type A',
      'Většina elektroniky (mobily, notebooky) je 100–240 V — stačí adaptér',
      'POZOR: fén může potřebovat transformátor',
    ],
  },
  {
    icon: '📡', title: 'Internet & SIM',
    items: [
      'eSIM: Airalo, Holafly, Ubigi (5 GB ~$20–30)',
      'Pocket WiFi: Ninja WiFi, Japan Wireless (~$5–10/den)',
      'Free WiFi: 7-Eleven, FamilyMart, Starbucks, metro stanice',
      'App: Japan Connected Free Wi-Fi',
      'Tip: Aktivuj eSIM den před cestou',
    ],
  },
  {
    icon: '🎫', title: 'JR Pass & Doprava',
    items: [
      'JR Pass: ¥50 000 / 7 dní (platí od 1. 10. 2023)',
      'Funguje na: shinkansen (kromě Nozomi/Mizuho), JR vlaky a autobusy',
      'Nefunguje na: metro, soukromé linky',
      'Suica / Pasmo karta: dobíj a placej kdekoli',
      'Welcome Suica: pro turisty, platnost 28 dní',
    ],
  },
  {
    icon: '📱', title: 'Užitečné aplikace',
    items: [
      'Google Maps — cesty, MHD, mapy offline',
      'Hyperdia — vlakové spojení (lepší než Google)',
      'Google Translate — offline JP, foto překlad',
      'PayPay — placení QR kódem (volitelné)',
      'Suica app — virtuální IC karta (jen iPhone)',
    ],
  },
];

/* ── Module state ────────────────────────────────────────────── */

let _exchangeRate    = null;
let _historyData     = [];
let _convHistory     = [];
let _activeCat       = 'basic';
let _searchTerm      = '';
let _container       = null;

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container   = container;
  _activeCat   = 'basic';
  _searchTerm  = '';
  _convHistory = [];

  container.innerHTML = buildShell();

  setupConverter();
  setupPhrasebook();
  renderPhrases();

  fetchExchangeRate();
  fetchHistoricalRates();

  return () => { _container = null; };
}

/* ── Shell ───────────────────────────────────────────────────── */

function buildShell() {
  const catChips = Object.entries(PHRASE_CATS).map(([k, c]) =>
    `<button class="phrase-cat-chip${k === _activeCat ? ' active' : ''}" data-cat="${k}">${c.icon} ${c.label}</button>`
  ).join('');

  const etiquetteHtml = ETIQUETTE.map(t => `
    <div class="tip-item">
      <div class="tip-icon">${t.icon}</div>
      <div class="tip-content">
        <strong>${t.title}</strong>
        <p>${t.text}</p>
      </div>
    </div>`).join('');

  const contactsHtml = CONTACTS.map(c => `
    <div class="contact-item">
      <div class="contact-icon">${c.icon}</div>
      <div class="contact-info">
        <strong>${c.name}</strong>
        <a href="tel:${c.number.replace(/\s/g, '')}" class="contact-number">${c.number}</a>
        <small>${c.desc}</small>
      </div>
    </div>`).join('');

  const techCards = TECH.map(t => `
    <div class="util-card">
      <div class="util-card__header">
        <span class="util-card__icon">${t.icon}</span>
        <h2 class="util-card__title">${t.title}</h2>
      </div>
      <ul class="tech-list">
        ${t.items.map(i => `<li>${i}</li>`).join('')}
      </ul>
    </div>`).join('');

  return `
    <div class="page page--enter japan-utils-page">
      <div class="page-header">
        <h1 class="page-header__title">🗾 Japan Utils</h1>
        <p class="page-header__subtitle">Vše co potřebuješ vědět o Japonsku</p>
      </div>

      <div class="utils-cards">

        <!-- Měnová kalkulačka -->
        <div class="util-card util-card--currency">
          <div class="util-card__header">
            <span class="util-card__icon">💱</span>
            <h2 class="util-card__title">Měnová kalkulačka</h2>
          </div>

          <div class="currency-rate" id="currency-rate-display">Načítám kurz…</div>

          <div class="currency-converter">
            <div class="converter-row">
              <input type="number" id="conv-jpy" class="converter-input" placeholder="0" step="100" min="0" aria-label="JPY" />
              <span class="converter-symbol">¥</span>
              <span class="converter-arrow">⇄</span>
              <input type="number" id="conv-czk" class="converter-input" placeholder="0" step="1" min="0" aria-label="CZK" />
              <span class="converter-symbol">Kč</span>
            </div>

            <div class="presets">
              ${[100, 500, 1000, 3000, 5000, 10000].map(a =>
                `<button class="preset-btn" data-amt="${a}">¥${a.toLocaleString('cs-CZ')}</button>`
              ).join('')}
            </div>

            <div class="conversion-history">
              <h3>Historie konverzí</h3>
              <div id="conv-history-list" class="history-list">
                <p class="empty-text">Zatím žádné konverze</p>
              </div>
            </div>

            <div id="rate-chart-wrap" style="margin-top:16px">
              <h3>Kurz JPY/CZK – posledních 30 dní</h3>
              <canvas id="rate-chart"></canvas>
            </div>
          </div>
        </div>

        <!-- Phrasebook -->
        <div class="util-card">
          <div class="util-card__header">
            <span class="util-card__icon">🗣️</span>
            <h2 class="util-card__title">Phrasebook (${PHRASES.length} frází)</h2>
          </div>

          <input type="search" id="phrase-search" class="form-input" placeholder="🔍 Hledat frázi…" autocomplete="off" />

          <div class="phrase-categories">${catChips}</div>

          <div class="phrase-list" id="phrase-list"></div>
        </div>

        <!-- Etiquette -->
        <div class="util-card">
          <div class="util-card__header">
            <span class="util-card__icon">🙇</span>
            <h2 class="util-card__title">Etiquette tipy</h2>
          </div>
          <div class="tips-list">${etiquetteHtml}</div>
        </div>

        <!-- Kontakty -->
        <div class="util-card">
          <div class="util-card__header">
            <span class="util-card__icon">☎️</span>
            <h2 class="util-card__title">Důležité kontakty</h2>
          </div>
          <div class="contacts-list">${contactsHtml}</div>
        </div>

        ${techCards}

      </div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════
   EXCHANGE RATE
   ════════════════════════════════════════════════════════════ */

async function fetchExchangeRate() {
  try {
    const res  = await fetch('https://api.frankfurter.app/latest?from=JPY&to=CZK');
    const data = await res.json();
    _exchangeRate = data.rates?.CZK ?? 0.16;
  } catch {
    _exchangeRate = 0.16;
  }

  const el = _container?.querySelector('#currency-rate-display');
  if (el) {
    el.innerHTML = `<strong>1 JPY = ${_exchangeRate.toFixed(4)} CZK</strong> <span style="font-weight:400;opacity:.7">(live)</span>`;
  }
}

async function fetchHistoricalRates() {
  try {
    const end   = new Date().toISOString().slice(0, 10);
    const from  = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const res   = await fetch(`https://api.frankfurter.app/${from}..${end}?from=JPY&to=CZK`);
    const data  = await res.json();
    _historyData = Object.entries(data.rates ?? {})
      .map(([date, rates]) => ({ date, rate: rates.CZK }))
      .sort((a, b) => a.date.localeCompare(b.date));
    drawChart();
  } catch {
    const wrap = _container?.querySelector('#rate-chart-wrap');
    if (wrap) wrap.hidden = true;
  }
}

function drawChart() {
  const canvas = _container?.querySelector('#rate-chart');
  if (!canvas || !_historyData.length) return;

  const W = canvas.parentElement.offsetWidth || 300;
  const H = 100;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const rates  = _historyData.map(d => d.rate);
  const min    = Math.min(...rates);
  const max    = Math.max(...rates);
  const spread = max - min || 0.001;
  const pad    = 12;

  ctx.clearRect(0, 0, W, H);

  // Fill under line
  ctx.beginPath();
  _historyData.forEach((d, i) => {
    const x = (i / (_historyData.length - 1)) * (W - pad * 2) + pad;
    const y = H - pad - ((d.rate - min) / spread) * (H - pad * 2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W - pad, H - pad);
  ctx.lineTo(pad, H - pad);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,132,255,0.12)';
  ctx.fill();

  // Line
  ctx.beginPath();
  _historyData.forEach((d, i) => {
    const x = (i / (_historyData.length - 1)) * (W - pad * 2) + pad;
    const y = H - pad - ((d.rate - min) / spread) * (H - pad * 2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#0A84FF';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Labels
  ctx.fillStyle = '#8E8E93';
  ctx.font      = '10px system-ui, sans-serif';
  ctx.fillText(`${max.toFixed(4)}`, pad, 10);
  ctx.fillText(`${min.toFixed(4)}`, pad, H - 2);
}

/* ════════════════════════════════════════════════════════════
   CONVERTER
   ════════════════════════════════════════════════════════════ */

function setupConverter() {
  const jpyEl = _container.querySelector('#conv-jpy');
  const czkEl = _container.querySelector('#conv-czk');

  jpyEl?.addEventListener('input', () => {
    if (!_exchangeRate) return;
    const jpy = parseFloat(jpyEl.value) || 0;
    czkEl.value = jpy > 0 ? (jpy * _exchangeRate).toFixed(2) : '';
    if (jpy > 0) addConvHistory(jpy, jpy * _exchangeRate);
  });

  czkEl?.addEventListener('input', () => {
    if (!_exchangeRate) return;
    const czk = parseFloat(czkEl.value) || 0;
    jpyEl.value = czk > 0 ? (czk / _exchangeRate).toFixed(0) : '';
  });

  _container.querySelector('.presets')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-btn');
    if (!btn || !_exchangeRate) return;
    const amt = parseFloat(btn.dataset.amt);
    if (jpyEl) jpyEl.value = amt;
    if (czkEl) czkEl.value = (amt * _exchangeRate).toFixed(2);
    addConvHistory(amt, amt * _exchangeRate);
  });
}

function addConvHistory(jpy, czk) {
  _convHistory.unshift({ jpy, czk });
  _convHistory = _convHistory.slice(0, 5);

  const list = _container?.querySelector('#conv-history-list');
  if (!list) return;
  list.innerHTML = _convHistory.map(c => `
    <div class="history-item">
      <span>¥${Math.round(c.jpy).toLocaleString('cs-CZ')}</span>
      <span class="history-arrow">=</span>
      <span><strong>${Math.round(c.czk).toLocaleString('cs-CZ')} Kč</strong></span>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   PHRASEBOOK
   ════════════════════════════════════════════════════════════ */

function setupPhrasebook() {
  _container.querySelector('.phrase-categories')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    _activeCat  = chip.dataset.cat;
    _searchTerm = '';
    const searchEl = _container.querySelector('#phrase-search');
    if (searchEl) searchEl.value = '';
    _container.querySelectorAll('.phrase-cat-chip').forEach(c => {
      c.classList.toggle('active', c === chip);
    });
    renderPhrases();
  });

  _container.querySelector('#phrase-search')?.addEventListener('input', (e) => {
    _searchTerm = e.target.value.trim();
    renderPhrases();
  });
}

function renderPhrases() {
  const list = _container?.querySelector('#phrase-list');
  if (!list) return;

  const q = _searchTerm.toLowerCase();
  const filtered = _searchTerm
    ? PHRASES.filter(p =>
        p.cz.toLowerCase().includes(q) ||
        p.jp.includes(_searchTerm) ||
        p.romaji.toLowerCase().includes(q)
      )
    : PHRASES.filter(p => p.cat === _activeCat);

  if (!filtered.length) {
    list.innerHTML = '<p class="empty-text">Nic nenalezeno</p>';
    return;
  }

  list.innerHTML = filtered.map(p => `
    <div class="phrase-item">
      <div class="phrase-cz">${p.cz}</div>
      <div class="phrase-jp">${p.jp}</div>
      <div class="phrase-romaji">${p.romaji}</div>
    </div>`).join('');
}
