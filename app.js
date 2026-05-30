'use strict';

const APP_VERSION = 'v1.0';
const APP_DATE = '28/05/2026';
const ANALYSIS_INTERVAL = '1d';
const ANALYSIS_RANGE = '1y';
const ANALYSIS_TIMEFRAME_LABEL = 'Daily';
const DEFAULT_TICKER = 'GGAL';
const YAHOO_HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com'
];

const el = {
  appVersion: document.getElementById('appVersion'),
  appDate: document.getElementById('appDate'),
  tickerInput: document.getElementById('tickerInput'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  resolvedSymbol: document.getElementById('resolvedSymbol'),
  analysisTimestamp: document.getElementById('analysisTimestamp'),
  signalCard: document.getElementById('signalCard'),
  recommendationText: document.getElementById('recommendationText'),
  trendText: document.getElementById('trendText'),
  reasonText: document.getElementById('reasonText'),
  priceValue: document.getElementById('priceValue'),
  changeValue: document.getElementById('changeValue'),
  volumeValue: document.getElementById('volumeValue'),
  rsiValue: document.getElementById('rsiValue'),
  rsiState: document.getElementById('rsiState'),
  contextValue: document.getElementById('contextValue'),
  distanceSummary: document.getElementById('distanceSummary'),
  ema21Value: document.getElementById('ema21Value'),
  ema50Value: document.getElementById('ema50Value'),
  ema200Value: document.getElementById('ema200Value'),
  dist21Value: document.getElementById('dist21Value'),
  dist50Value: document.getElementById('dist50Value'),
  dist200Value: document.getElementById('dist200Value'),
  explanationList: document.getElementById('explanationList'),
  errorCard: document.getElementById('errorCard'),
  errorText: document.getElementById('errorText')
};

el.appVersion.textContent = APP_VERSION;
el.appDate.textContent = APP_DATE;

el.tickerInput.value = DEFAULT_TICKER;
el.analyzeBtn.addEventListener('click', handleAnalyze);
el.tickerInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleAnalyze();
  }
});

async function handleAnalyze() {
  const rawInput = el.tickerInput.value.trim().toUpperCase();
  if (!rawInput) {
    showError('Ingresá un ticker antes de analizar.');
    return;
  }

  setLoadingState(rawInput);
  hideError();

  try {
    const payload = await resolveSymbolAndFetch(rawInput);
    const result = buildAnalysis(payload, rawInput);
    renderAnalysis(result);
  } catch (error) {
    console.error(error);
    showError('No se pudo obtener información confiable para este ticker.');
    resetMetrics();
  } finally {
    el.analyzeBtn.disabled = false;
    el.analyzeBtn.textContent = 'Analizar';
  }
}

function setLoadingState(rawInput) {
  el.analyzeBtn.disabled = true;
  el.analyzeBtn.textContent = 'Analizando...';
  el.resolvedSymbol.textContent = rawInput;
  el.analysisTimestamp.textContent = 'Consultando fuente...';
  el.recommendationText.textContent = 'Cargando';
  el.trendText.textContent = '-';
  el.reasonText.textContent = 'Buscando datos diarios e indicadores.';
}

function getCandidateSymbols(input) {
  const normalized = input.trim().toUpperCase();
  if (!normalized) return [];
  if (normalized.endsWith('.BA')) return [normalized];

  const candidates = [normalized, `${normalized}.BA`];
  return [...new Set(candidates)];
}

async function resolveSymbolAndFetch(input) {
  const candidates = getCandidateSymbols(input);
  const found = [];
  let lastError = null;

  for (const symbol of candidates) {
    try {
      const chart = await fetchYahooChart(symbol);
      if (hasEnoughData(chart)) {
        found.push({ symbol, chart });
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!found.length) {
    throw lastError || new Error('No data returned');
  }

  const preferred = pickPreferredResult(input, found);
  return {
    ...preferred,
    attempted: candidates
  };
}

function pickPreferredResult(input, results) {
  const normalized = input.toUpperCase();
  const exact = results.find(item => item.symbol === normalized);
  const local = results.find(item => item.symbol === `${normalized}.BA`);

  if (normalized.endsWith('.BA')) {
    return exact || results[0];
  }

  return local || exact || results[0];
}

async function fetchYahooChart(symbol) {
  let lastError = null;

  for (const host of YAHOO_HOSTS) {
    const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${ANALYSIS_INTERVAL}&range=${ANALYSIS_RANGE}&includePrePost=false&events=div%7Csplit&corsDomain=finance.yahoo.com`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Yahoo HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data?.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      if (!result || !quote) {
        throw new Error('Malformed Yahoo response');
      }
      return result;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('Yahoo fetch failed');
}

function hasEnoughData(chartResult) {
  const closes = getCleanCloseSeries(chartResult);
  return closes.length >= 210;
}

function getCleanCloseSeries(chartResult) {
  const quote = chartResult.indicators?.quote?.[0];
  const adjClose = chartResult.indicators?.adjclose?.[0]?.adjclose;
  const closes = adjClose || quote?.close || [];
  return closes.filter(value => Number.isFinite(value));
}

function buildAnalysis(payload, userInput) {
  const closes = getCleanCloseSeries(payload.chart);
  const rawQuote = payload.chart.indicators.quote[0];
  const closeArray = payload.chart.indicators.adjclose?.[0]?.adjclose || rawQuote.close;
  const volumeArray = rawQuote.volume || [];
  const timestamps = payload.chart.timestamp || [];

  const lastIndex = findLastFiniteIndex(closeArray);
  if (lastIndex < 1) {
    throw new Error('Not enough close points');
  }

  const latestClose = closeArray[lastIndex];
  const previousClose = findPreviousFinite(closeArray, lastIndex - 1);
  const lastVolume = Number.isFinite(volumeArray[lastIndex]) ? volumeArray[lastIndex] : null;

  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi14 = calculateRSI(closes, 14);

  const change = latestClose - previousClose;
  const changePct = previousClose ? (change / previousClose) * 100 : 0;
  const dist21 = percentageDistance(latestClose, ema21);
  const dist50 = percentageDistance(latestClose, ema50);
  const dist200 = percentageDistance(latestClose, ema200);

  const trend = resolveTrend(latestClose, ema21, ema50, ema200);
  const recommendation = resolveRecommendation({
    price: latestClose,
    ema21,
    ema50,
    ema200,
    rsi14,
    dist21,
    dist50,
    dist200,
    trend
  });

  const timestamp = timestamps[lastIndex]
    ? new Date(timestamps[lastIndex] * 1000)
    : new Date();

  const explanation = buildExplanation({
    price: latestClose,
    ema21,
    ema50,
    ema200,
    rsi14,
    dist21,
    dist50,
    dist200,
    trend,
    recommendation
  });

  return {
    input: userInput,
    symbol: payload.symbol,
    attempted: payload.attempted,
    price: latestClose,
    previousClose,
    change,
    changePct,
    volume: lastVolume,
    ema21,
    ema50,
    ema200,
    rsi14,
    dist21,
    dist50,
    dist200,
    trend,
    recommendation,
    summaryReason: buildSummaryReason({ recommendation, trend, rsi14, price: latestClose, ema21, ema50, ema200, dist21 }),
    explanation,
    timestamp
  };
}

function calculateEMA(values, period) {
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(values, period) {
  if (values.length <= period) return NaN;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function percentageDistance(price, base) {
  return ((price - base) / base) * 100;
}

function resolveTrend(price, ema21, ema50, ema200) {
  if (price > ema21 && ema21 > ema50 && ema50 > ema200) return 'Alcista';
  if (price < ema50 && ema50 < ema200) return 'Bajista';
  return 'Neutral';
}

function resolveRecommendation({ price, ema21, ema50, ema200, rsi14, dist21, trend }) {
  const bullishStructure = price > ema21 && price > ema50 && price > ema200 && ema21 > ema50 && ema50 > ema200;
  const bearishStructure = price < ema200 || (price < ema50 && ema50 < ema200);
  const overheated = rsi14 > 70 || dist21 > 9;
  const mildlyExtended = (rsi14 >= 65 && rsi14 <= 70) || (dist21 > 4 && dist21 <= 9);

  if (bearishStructure) {
    return 'NO ENTRAR';
  }

  if (bullishStructure && overheated) {
    return 'TOMAR GANANCIA';
  }

  if (bullishStructure && rsi14 >= 45 && rsi14 <= 65) {
    return 'COMPRAR';
  }

  if (trend === 'Alcista' && mildlyExtended) {
    return 'MANTENER';
  }

  return 'ESPERAR';
}

function buildExplanation({ price, ema21, ema50, ema200, rsi14, dist21, dist50, trend, recommendation }) {
  const bullets = [];

  bullets.push(`Símbolo leído en rueda diaria. Precio actual ${formatPrice(price)} frente a EMA 21 ${formatPrice(ema21)}, EMA 50 ${formatPrice(ema50)} y EMA 200 ${formatPrice(ema200)}.`);
  bullets.push(`RSI 14 en ${formatNumber(rsi14, 1)}. ${describeRsi(rsi14)}`);
  bullets.push(`La distancia al precio medio corto es ${formatSignedPercentage(dist21)} y frente a EMA 50 es ${formatSignedPercentage(dist50)}. Tendencia general: ${trend.toLowerCase()}.`);

  switch (recommendation) {
    case 'COMPRAR':
      bullets.push('La estructura está limpia: precio por encima de las tres EMAs, EMA 21 sobre EMA 50 y RSI en zona razonable. La señal favorece una entrada técnica.');
      break;
    case 'MANTENER':
      bullets.push('La tendencia sigue sana, pero el activo ya viene exigido. Sirve más para sostener posición que para perseguir precio.');
      break;
    case 'TOMAR GANANCIA':
      bullets.push('La tendencia puede seguir alcista, pero el precio está demasiado extendido o con RSI alto. Conviene proteger recorrido y no agregar riesgo nuevo.');
      break;
    case 'NO ENTRAR':
      bullets.push('El precio está por debajo de la estructura de fondo o la pendiente es bajista. Técnicamente no hay ventaja para abrir posición.');
      break;
    default:
      bullets.push('Las señales no están alineadas. Falta confirmación para una compra clara y tampoco hay una salida obvia si todavía no estás adentro.');
      break;
  }

  return bullets;
}

function buildSummaryReason({ recommendation, trend, rsi14, price, ema21, ema50, ema200, dist21 }) {
  const aboveAll = price > ema21 && price > ema50 && price > ema200;

  if (recommendation === 'COMPRAR') {
    return 'El precio está sobre las tres EMAs, la pendiente acompaña y el RSI sigue en zona razonable para tendencia.';
  }

  if (recommendation === 'MANTENER') {
    return 'La tendencia sigue alcista, pero el activo ya está algo exigido. Sirve más para sostener posición que para entrar apurado.';
  }

  if (recommendation === 'TOMAR GANANCIA') {
    return 'La estructura puede seguir positiva, pero el RSI o la distancia frente a EMA 21 muestran una extensión demasiado grande.';
  }

  if (recommendation === 'NO ENTRAR') {
    return 'El precio quedó por debajo de la estructura de fondo o la tendencia diaria sigue bajista. No hay ventaja técnica para entrar.';
  }

  if (trend === 'Neutral' && !aboveAll) {
    return 'Las señales están mezcladas. No hay confirmación suficiente para compra ni un escenario de continuación claro.';
  }

  if (rsi14 > 65 || dist21 > 4) {
    return 'Hay algo de impulso, pero el precio ya está extendido. Conviene esperar una entrada más prolija.';
  }

  return 'La lectura diaria no está limpia. Mejor esperar confirmación antes de tomar posición.';
}

function describeRsi(rsi) {
  if (rsi > 70) return 'Zona de sobrecompra.';
  if (rsi < 35) return 'Zona débil o potencial de rebote, pero todavía frágil.';
  if (rsi >= 45 && rsi <= 65) return 'Zona de equilibrio razonable para seguir tendencia.';
  return 'Zona intermedia sin ventaja demasiado marcada.';
}

function renderAnalysis(result) {
  hideError();
  const dateTimeText = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(result.timestamp);

  el.resolvedSymbol.textContent = result.symbol;
  el.analysisTimestamp.textContent = `${dateTimeText} · ${ANALYSIS_TIMEFRAME_LABEL}`;
  el.recommendationText.textContent = result.recommendation;
  el.trendText.textContent = result.trend;
  el.reasonText.textContent = result.summaryReason;
  el.priceValue.textContent = formatPrice(result.price);
  el.changeValue.textContent = `${formatSignedPrice(result.change)} · ${formatSignedPercentage(result.changePct)}`;
  el.changeValue.className = `metric-sub ${getSignedClass(result.change)}`;
  el.volumeValue.textContent = result.volume ? formatVolume(result.volume) : 'Sin dato';
  el.rsiValue.textContent = formatNumber(result.rsi14, 1);
  el.rsiState.textContent = describeRsi(result.rsi14);
  el.contextValue.textContent = result.trend;
  el.distanceSummary.textContent = `EMA 21 ${formatSignedPercentage(result.dist21)}`;
  el.ema21Value.textContent = formatPrice(result.ema21);
  el.ema50Value.textContent = formatPrice(result.ema50);
  el.ema200Value.textContent = formatPrice(result.ema200);
  el.dist21Value.textContent = formatSignedPercentage(result.dist21);
  el.dist50Value.textContent = formatSignedPercentage(result.dist50);
  el.dist200Value.textContent = formatSignedPercentage(result.dist200);

  renderExplanationList(result.explanation);
  applySignalClass(result.recommendation);
}

function renderExplanationList(items) {
  el.explanationList.innerHTML = '';
  items.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    el.explanationList.appendChild(li);
  });
}

function applySignalClass(signal) {
  el.signalCard.className = 'signal-card';

  if (signal === 'COMPRAR') el.signalCard.classList.add('signal-buy');
  else if (signal === 'MANTENER') el.signalCard.classList.add('signal-hold');
  else if (signal === 'TOMAR GANANCIA') el.signalCard.classList.add('signal-take');
  else if (signal === 'NO ENTRAR') el.signalCard.classList.add('signal-avoid');
  else el.signalCard.classList.add('signal-wait');
}

function resetMetrics() {
  el.recommendationText.textContent = 'Sin análisis';
  el.trendText.textContent = '-';
  el.reasonText.textContent = 'No hubo datos suficientes para armar una lectura técnica confiable.';
  el.priceValue.textContent = '-';
  el.changeValue.textContent = '-';
  el.changeValue.className = 'metric-sub';
  el.volumeValue.textContent = '-';
  el.rsiValue.textContent = '-';
  el.rsiState.textContent = '-';
  el.contextValue.textContent = '-';
  el.distanceSummary.textContent = '-';
  el.ema21Value.textContent = '-';
  el.ema50Value.textContent = '-';
  el.ema200Value.textContent = '-';
  el.dist21Value.textContent = '-';
  el.dist50Value.textContent = '-';
  el.dist200Value.textContent = '-';
  renderExplanationList(['No se pudo completar el análisis técnico.']);
  applySignalClass('ESPERAR');
}

function showError(message) {
  el.errorText.textContent = message;
  el.errorCard.hidden = false;
}

function hideError() {
  el.errorCard.hidden = true;
}

function formatPrice(value) {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatSignedPrice(value) {
  const formatted = formatPrice(Math.abs(value));
  return `${value >= 0 ? '+' : '-'}${formatted}`;
}

function formatSignedPercentage(value) {
  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(value));
  return `${value >= 0 ? '+' : '-'}${formatted}%`;
}

function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

function formatVolume(value) {
  return new Intl.NumberFormat('es-AR', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value);
}

function getSignedClass(value) {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

function findLastFiniteIndex(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) return i;
  }
  return -1;
}

function findPreviousFinite(values, startIndex) {
  for (let i = startIndex; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) return values[i];
  }
  throw new Error('No previous close');
}

handleAnalyze();
