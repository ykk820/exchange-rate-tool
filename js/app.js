// ============================================================
// State
// ============================================================
const state = {
    rates: {},
    baseCurrency: 'TWD',
    targetCurrency: 'JPY',
    amount: 10000,
    lastUpdate: null,
    cards: [],
    historicalRates: [],
    alerts: JSON.parse(localStorage.getItem('paysmart_alerts') || '[]'),
    expenses: [{ id: Date.now(), currency: 'JPY', amount: 10000, label: '' }],
};

const CURRENCIES = {
    JPY: { name: '日圓', flag: '🇯🇵' },
    USD: { name: '美元', flag: '🇺🇸' },
    EUR: { name: '歐元', flag: '🇪🇺' },
    KRW: { name: '韓元', flag: '🇰🇷' },
    THB: { name: '泰銖', flag: '🇹🇭' },
    GBP: { name: '英鎊', flag: '🇬🇧' },
    AUD: { name: '澳幣', flag: '🇦🇺' },
};

// ============================================================
// DOM
// ============================================================
const els = {
    currencySelect: document.getElementById('currency-select'),
    spendAmount: document.getElementById('spend-amount'),
    currencySuffix: document.getElementById('currency-suffix'),
    currentRateDisplay: document.getElementById('current-rate-display'),
    lastUpdated: document.getElementById('last-updated'),
    cardsContainer: document.getElementById('cards-container'),
    bestMethodName: document.getElementById('best-method-name'),
    bestTotalTwd: document.getElementById('best-total-twd'),
    bestCashbackTwd: document.getElementById('best-cashback-twd'),
    leaderboardBody: document.getElementById('leaderboard-body'),
    modal: document.getElementById('card-modal'),
    addCardBtn: document.getElementById('add-card-btn'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    saveCardBtn: document.getElementById('save-card-btn'),
    newCardName: document.getElementById('new-card-name'),
    newCardFee: document.getElementById('new-card-fee'),
    newCardReward: document.getElementById('new-card-reward'),
    syncCardsBtn: document.getElementById('sync-cards-btn'),
    savingsSummary: document.getElementById('savings-summary'),
    trendStats: document.getElementById('trend-stats'),
    alertCurrencyLabel: document.getElementById('alert-currency-label'),
    alertThreshold: document.getElementById('alert-threshold'),
    setAlertBtn: document.getElementById('set-alert-btn'),
    alertList: document.getElementById('alert-list'),
    alertBanner: document.getElementById('alert-banner'),
    alertBannerText: document.getElementById('alert-banner-text'),
    dismissAlertBtn: document.getElementById('dismiss-alert-btn'),
    multiExpenses: document.getElementById('multi-expenses'),
    addExpenseBtn: document.getElementById('add-expense-btn'),
    multiResults: document.getElementById('multi-results'),
};

let trendChart = null;
let savingsChart = null;

// ============================================================
// Init
// ============================================================
async function init() {
    setupEventListeners();
    await Promise.all([fetchRates(), fetchCards()]);
    calculateAndRender();
    await fetchHistoricalRates(7);
    renderTimingModel();
    renderAlerts();
    renderMultiExpenses();
    calculateMultiExpenses();
}

// ============================================================
// Utilities
// ============================================================
function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function saveCardsToStorage() {
    localStorage.setItem('paysmart_cards', JSON.stringify(state.cards));
}

function loadCardsFromStorage() {
    try { return JSON.parse(localStorage.getItem('paysmart_cards')); } catch { return null; }
}

function saveAlerts() {
    localStorage.setItem('paysmart_alerts', JSON.stringify(state.alerts));
}

function getMidRate(currency) {
    if (!state.rates[currency]) return null;
    return 1 / state.rates[currency];
}

// ============================================================
// Data Fetching
// ============================================================
async function fetchCards() {
    try {
        const res = await fetch('data/cards.json?v=' + Date.now());
        if (!res.ok) throw new Error('Network response was not ok');
        state.cards = await res.json();
        saveCardsToStorage();
    } catch (error) {
        console.error('Fetch cards failed:', error);
        const cached = loadCardsFromStorage();
        if (cached && cached.length > 0) { state.cards = cached; }
        else if (state.cards.length === 0) {
            state.cards = [
                { id: 'c1', name: '預設：一般信用卡', type: 'credit', fee: 1.5, reward: 1.0 },
                { id: 'cash', name: '銀行現金換匯 (預估)', type: 'cash', fee: 0, reward: 0, spread: 1.012 }
            ];
        }
    }
    renderCards();
}

async function fetchRates() {
    try {
        els.lastUpdated.textContent = '匯率更新中...';
        const res = await fetch('https://open.er-api.com/v6/latest/TWD');
        const data = await res.json();
        if (data.result === 'success') {
            state.rates = data.rates;
            const date = new Date(data.time_last_update_unix * 1000);
            state.lastUpdate = date.toLocaleString('zh-TW');
            els.lastUpdated.textContent = `最後更新: ${state.lastUpdate}`;
        } else { throw new Error('API Error'); }
    } catch (error) {
        console.error('Fetch rates failed:', error);
        els.lastUpdated.textContent = '匯率更新失敗，使用預估值';
        state.rates = { JPY: 4.65, USD: 0.031, EUR: 0.029, KRW: 42.5, THB: 1.12, GBP: 0.025, AUD: 0.048 };
    }
}

async function fetchHistoricalRates(days) {
    const currency = state.targetCurrency;
    const currentRate = getMidRate(currency);
    if (!currentRate) return;

    // Try Frankfurter API for real historical data
    try {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);
        const fmt = d => d.toISOString().slice(0, 10);

        const res = await fetch(`https://api.frankfurter.dev/${fmt(start)}..${fmt(end)}?from=TWD&to=${currency}`);
        if (!res.ok) throw new Error('API failed');
        const data = await res.json();

        const rates = Object.entries(data.rates).map(([date, r]) => ({
            date,
            rate: 1 / r[currency]
        }));

        if (rates.length > 2) {
            state.historicalRates = rates;
            renderTrendChart();
            renderTimingModel();
            checkAlerts();
            return;
        }
        throw new Error('Insufficient data');
    } catch (e) {
        console.warn('Frankfurter API failed, generating simulated data:', e.message);
    }

    // Fallback: generate realistic simulated data
    const volatility = currentRate * 0.003;
    const points = [];
    let rate = currentRate * (1 + (Math.random() - 0.5) * 0.04);
    for (let i = days; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        rate += (Math.random() - 0.48) * volatility;
        rate = Math.max(rate * 0.95, Math.min(rate * 1.05, rate));
        points.push({ date: d.toISOString().slice(0, 10), rate });
    }
    points[points.length - 1].rate = currentRate;
    state.historicalRates = points;
    renderTrendChart();
    renderTimingModel();
    checkAlerts();
}

// ============================================================
// Event Listeners
// ============================================================
function setupEventListeners() {
    els.currencySelect.addEventListener('change', (e) => {
        state.targetCurrency = e.target.value;
        els.currencySuffix.textContent = state.targetCurrency;
        els.alertCurrencyLabel.textContent = state.targetCurrency;
        calculateAndRender();
        fetchHistoricalRates(getActiveTrendDays());
    });

    els.spendAmount.addEventListener('input', debounce((e) => {
        state.amount = parseFloat(e.target.value) || 0;
        calculateAndRender();
    }, 150));

    // Modal
    els.addCardBtn.addEventListener('click', () => {
        els.modal.classList.remove('hidden');
        els.modal.classList.add('active');
        els.newCardName.focus();
    });
    els.closeModalBtn.addEventListener('click', closeModal);
    els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
    els.saveCardBtn.addEventListener('click', saveNewCard);
    els.newCardName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNewCard(); });

    // Sync cards
    if (els.syncCardsBtn) {
        els.syncCardsBtn.addEventListener('click', async () => {
            els.syncCardsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 同步中...';
            els.syncCardsBtn.disabled = true;
            await fetchCards();
            calculateAndRender();
            els.syncCardsBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 更新優惠';
            els.syncCardsBtn.disabled = false;
        });
    }

    // Trend buttons
    document.querySelectorAll('.trend-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.trend-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            fetchHistoricalRates(parseInt(btn.dataset.days));
        });
    });

    // Alerts
    els.setAlertBtn.addEventListener('click', addAlert);
    els.alertThreshold.addEventListener('keydown', (e) => { if (e.key === 'Enter') addAlert(); });
    els.dismissAlertBtn.addEventListener('click', () => els.alertBanner.classList.add('hidden'));

    // Multi-expense
    els.addExpenseBtn.addEventListener('click', () => {
        state.expenses.push({ id: Date.now(), currency: state.targetCurrency, amount: 0, label: '' });
        renderMultiExpenses();
    });
}

function getActiveTrendDays() {
    const active = document.querySelector('.trend-btn.active');
    return active ? parseInt(active.dataset.days) : 7;
}

function closeModal() {
    els.modal.classList.remove('active');
    els.modal.classList.add('hidden');
}

function saveNewCard() {
    const name = els.newCardName.value.trim();
    const fee = parseFloat(els.newCardFee.value) || 0;
    const reward = parseFloat(els.newCardReward.value) || 0;
    if (!name) {
        els.newCardName.classList.add('input-error');
        els.newCardName.addEventListener('input', () => els.newCardName.classList.remove('input-error'), { once: true });
        return;
    }
    state.cards.push({ id: 'c' + Date.now(), name, type: 'credit', fee, reward });
    saveCardsToStorage();
    els.newCardName.value = '';
    els.newCardFee.value = '1.5';
    els.newCardReward.value = '3.0';
    closeModal();
    renderCards();
    calculateAndRender();
}

function deleteCard(id) {
    if (id === 'cash') return;
    state.cards = state.cards.filter(c => c.id !== id);
    saveCardsToStorage();
    renderCards();
    calculateAndRender();
}

// ============================================================
// Render: Cards
// ============================================================
function renderCards() {
    els.cardsContainer.innerHTML = '';
    state.cards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = `payment-card ${card.type}-card`;
        const icon = card.type === 'cash' ? 'fa-money-bill-wave' : 'fa-credit-card';
        let detailsHtml = card.type === 'cash'
            ? `<span><i class="fa-solid fa-arrow-trend-up"></i> 預估匯差: +${((card.spread - 1) * 100).toFixed(1)}%</span>`
            : `<span><i class="fa-solid fa-file-invoice"></i> 手續費: ${card.fee}%</span>
               <span><i class="fa-solid fa-gift"></i> 回饋: ${card.reward}%</span>`;
        const deleteBtn = card.type === 'cash' ? '' : `<button onclick="deleteCard('${card.id}')" title="刪除"><i class="fa-solid fa-trash-can"></i></button>`;
        cardEl.innerHTML = `
            <div class="card-info">
                <h4><i class="fa-solid ${icon}"></i> ${card.name}</h4>
                <div class="card-details">${detailsHtml}</div>
            </div>
            <div class="card-actions">${deleteBtn}</div>`;
        els.cardsContainer.appendChild(cardEl);
    });
}

// ============================================================
// Core Calculation
// ============================================================
function computeResults(currency, amount, cards) {
    const midRate = getMidRate(currency);
    if (!midRate || amount <= 0) return [];
    return cards.map(card => {
        const baseCostTwd = amount * midRate;
        let finalCostTwd, cashbackTwd = 0;
        if (card.type === 'cash') {
            finalCostTwd = baseCostTwd * (card.spread || 1);
        } else {
            const costWithFee = baseCostTwd * (1 + card.fee / 100);
            cashbackTwd = baseCostTwd * (card.reward / 100);
            finalCostTwd = costWithFee - cashbackTwd;
        }
        return { ...card, finalCostTwd, cashbackTwd, effectiveRate: finalCostTwd / amount };
    }).sort((a, b) => a.finalCostTwd - b.finalCostTwd);
}

function calculateAndRender() {
    const midRate = getMidRate(state.targetCurrency);
    if (!midRate) return;

    els.currentRateDisplay.textContent = `1 ${state.targetCurrency} = ${midRate.toFixed(4)} TWD`;

    if (state.amount <= 0) {
        els.bestMethodName.textContent = '請輸入消費金額';
        els.bestTotalTwd.textContent = '--';
        els.bestCashbackTwd.textContent = '--';
        els.leaderboardBody.innerHTML = '';
        els.savingsSummary.innerHTML = '';
        return;
    }

    const results = computeResults(state.targetCurrency, state.amount, state.cards);
    if (results.length === 0) return;

    // Best recommendation
    const best = results[0];
    els.bestMethodName.textContent = best.name;
    els.bestTotalTwd.textContent = `NT$ ${Math.round(best.finalCostTwd).toLocaleString()}`;
    els.bestCashbackTwd.textContent = best.cashbackTwd > 0 ? `+NT$ ${Math.round(best.cashbackTwd).toLocaleString()}` : 'NT$ 0';

    // Leaderboard
    els.leaderboardBody.innerHTML = '';
    results.forEach((res, i) => {
        const rank = i + 1;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="rank-badge ${rank <= 3 ? 'rank-' + rank : 'rank-other'}">${rank}</span></td>
            <td>${res.name}</td>
            <td class="net-cost">NT$ ${Math.round(res.finalCostTwd).toLocaleString()}</td>
            <td>${res.effectiveRate.toFixed(4)}</td>`;
        els.leaderboardBody.appendChild(tr);
    });

    // Savings comparison
    renderSavingsChart(results);
}

// ============================================================
// Render: Savings Chart
// ============================================================
function renderSavingsChart(results) {
    const best = results[0];
    const worst = results[results.length - 1];
    const saved = Math.round(worst.finalCostTwd - best.finalCostTwd);

    els.savingsSummary.innerHTML = saved > 0
        ? `用 <strong>${best.name}</strong> 比最貴方案省下 <span class="savings-amount">NT$ ${saved.toLocaleString()}</span>`
        : `所有方案成本相同`;

    const ctx = document.getElementById('savings-chart').getContext('2d');
    if (savingsChart) savingsChart.destroy();

    const colors = results.map((_, i) =>
        i === 0 ? 'rgba(16,185,129,0.8)' : i === results.length - 1 ? 'rgba(239,68,68,0.6)' : 'rgba(139,92,246,0.5)');

    savingsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: results.map(r => r.name.length > 10 ? r.name.slice(0, 10) + '…' : r.name),
            datasets: [{
                label: '淨成本 (TWD)',
                data: results.map(r => Math.round(r.finalCostTwd)),
                backgroundColor: colors,
                borderRadius: 8,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `NT$ ${ctx.raw.toLocaleString()}`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#94a3b8', callback: v => 'NT$ ' + v.toLocaleString() },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    beginAtZero: false,
                    suggestedMin: Math.round(best.finalCostTwd * 0.95),
                }
            }
        }
    });
}

// ============================================================
// Render: Trend Chart
// ============================================================
function renderTrendChart() {
    const data = state.historicalRates;
    if (data.length < 2) return;

    const labels = data.map(d => d.date.slice(5));
    const values = data.map(d => d.rate);

    // Compute 7-day SMA for overlay
    const sma7 = values.map((_, i) => {
        if (i < 6) return null;
        const slice = values.slice(i - 6, i + 1);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
    });

    const ctx = document.getElementById('trend-chart').getContext('2d');
    if (trendChart) trendChart.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(6,182,212,0.3)');
    gradient.addColorStop(1, 'rgba(6,182,212,0)');

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: `1 ${state.targetCurrency} = TWD`,
                    data: values,
                    borderColor: '#06b6d4',
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.3,
                    pointRadius: data.length > 40 ? 0 : 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                },
                {
                    label: '7日均線',
                    data: sma7,
                    borderColor: 'rgba(245,158,11,0.6)',
                    borderDash: [5, 5],
                    pointRadius: 0,
                    borderWidth: 1.5,
                    fill: false,
                    tension: 0.3,
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'line' }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.raw !== null ? `${ctx.dataset.label}: ${ctx.raw.toFixed(4)}` : ''
                    }
                }
            },
            scales: {
                x: { ticks: { color: '#94a3b8', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.03)' } },
                y: { ticks: { color: '#94a3b8', callback: v => v.toFixed(4) }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });

    // Stats below chart
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const current = values[values.length - 1];
    const change = ((current - values[0]) / values[0] * 100);

    els.trendStats.innerHTML = `
        <div class="trend-stat"><span class="trend-stat-label">最低</span><span class="trend-stat-value" style="color:var(--success)">${min.toFixed(4)}</span></div>
        <div class="trend-stat"><span class="trend-stat-label">最高</span><span class="trend-stat-value" style="color:var(--danger)">${max.toFixed(4)}</span></div>
        <div class="trend-stat"><span class="trend-stat-label">平均</span><span class="trend-stat-value">${avg.toFixed(4)}</span></div>
        <div class="trend-stat"><span class="trend-stat-label">現在</span><span class="trend-stat-value" style="color:var(--primary)">${current.toFixed(4)}</span></div>
        <div class="trend-stat"><span class="trend-stat-label">期間漲跌</span><span class="trend-stat-value" style="color:${change >= 0 ? 'var(--danger)' : 'var(--success)'}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span></div>
    `;
}

// ============================================================
// Timing Model
// ============================================================
function renderTimingModel() {
    const data = state.historicalRates;
    if (data.length < 5) return;

    const values = data.map(d => d.rate);
    const current = values[values.length - 1];
    const n = values.length;

    // 1. Trend: linear regression slope
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    values.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
    const slope = num / den;
    const slopePercent = (slope / yMean) * 100;

    // 2. MA position: current vs SMA
    const sma = values.reduce((a, b) => a + b, 0) / n;
    const maDeviation = ((current - sma) / sma) * 100;

    // 3. Volatility: coefficient of variation
    const stdDev = Math.sqrt(values.reduce((sum, v) => sum + (v - yMean) ** 2, 0) / n);
    const cv = (stdDev / yMean) * 100;

    // 4. Momentum: rate of change last 3 days vs previous 3 days
    const recent3 = values.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const prev3 = values.slice(-6, -3).reduce((a, b) => a + b, 0) / Math.min(3, values.slice(-6, -3).length || 1);
    const momentum = ((recent3 - prev3) / prev3) * 100;

    // Composite score: lower midRate = cheaper foreign currency = better to buy
    // Positive signals for buying: rate below average, downward trend, negative momentum
    let score = 0;
    let maxScore = 0;

    // Below MA → good (cheaper now)
    maxScore += 30;
    if (maDeviation < -1) score += 30;
    else if (maDeviation < 0) score += 20;
    else if (maDeviation < 1) score += 10;

    // Downward trend → rate getting cheaper
    maxScore += 30;
    if (slopePercent < -0.1) score += 30;
    else if (slopePercent < 0) score += 20;
    else if (slopePercent < 0.1) score += 10;

    // Negative momentum → still falling
    maxScore += 20;
    if (momentum < -0.3) score += 20;
    else if (momentum < 0) score += 15;
    else if (momentum < 0.3) score += 5;

    // Low volatility → stable, less risk waiting
    maxScore += 20;
    if (cv < 0.5) score += 15;
    else if (cv < 1) score += 10;
    else score += 5;

    const confidence = Math.round((score / maxScore) * 100);

    // Determine signal
    let signal, signalClass, signalIcon, signalDesc;
    if (confidence >= 75) {
        signal = '立即換匯';
        signalClass = 'strong-buy';
        signalIcon = 'fa-solid fa-bolt';
        signalDesc = '匯率低於均線且持續走低，目前是換匯的好時機';
    } else if (confidence >= 55) {
        signal = '建議換匯';
        signalClass = 'buy';
        signalIcon = 'fa-solid fa-thumbs-up';
        signalDesc = '匯率處於合理區間偏低，可以考慮換匯';
    } else if (confidence >= 35) {
        signal = '持平觀望';
        signalClass = 'hold';
        signalIcon = 'fa-solid fa-hourglass-half';
        signalDesc = '匯率無明確方向，可分批換匯降低風險';
    } else {
        signal = '建議等待';
        signalClass = 'wait';
        signalIcon = 'fa-solid fa-clock';
        signalDesc = '匯率偏高且有上升趨勢，建議再等等看';
    }

    // Render signal
    const iconEl = document.getElementById('signal-icon');
    iconEl.className = `signal-icon ${signalClass}`;
    iconEl.innerHTML = `<i class="${signalIcon}"></i>`;
    document.getElementById('signal-title').textContent = signal;
    document.getElementById('signal-desc').textContent = signalDesc;
    document.getElementById('conf-bar-fill').style.width = confidence + '%';
    document.getElementById('conf-value').textContent = confidence + '%';

    // Render indicators
    const trendDir = slopePercent < -0.05 ? '下降' : slopePercent > 0.05 ? '上升' : '持平';
    const trendClass = slopePercent < -0.05 ? 'bullish' : slopePercent > 0.05 ? 'bearish' : 'neutral';
    document.getElementById('ind-trend').className = `ind-value ${trendClass}`;
    document.getElementById('ind-trend').textContent = trendDir;
    document.getElementById('ind-trend-detail').textContent = `日均變動 ${slopePercent >= 0 ? '+' : ''}${slopePercent.toFixed(3)}%`;

    const maPos = maDeviation < 0 ? '低於均線' : '高於均線';
    const maClass = maDeviation < 0 ? 'bullish' : 'bearish';
    document.getElementById('ind-ma').className = `ind-value ${maClass}`;
    document.getElementById('ind-ma').textContent = maPos;
    document.getElementById('ind-ma-detail').textContent = `偏離 ${maDeviation >= 0 ? '+' : ''}${maDeviation.toFixed(2)}%`;

    const volLevel = cv < 0.5 ? '低波動' : cv < 1.5 ? '中波動' : '高波動';
    const volClass = cv < 0.5 ? 'bullish' : cv < 1.5 ? 'neutral' : 'bearish';
    document.getElementById('ind-vol').className = `ind-value ${volClass}`;
    document.getElementById('ind-vol').textContent = volLevel;
    document.getElementById('ind-vol-detail').textContent = `CV = ${cv.toFixed(2)}%`;

    const momDir = momentum < -0.1 ? '減速中' : momentum > 0.1 ? '加速中' : '平穩';
    const momClass = momentum < -0.1 ? 'bullish' : momentum > 0.1 ? 'bearish' : 'neutral';
    document.getElementById('ind-momentum').className = `ind-value ${momClass}`;
    document.getElementById('ind-momentum').textContent = momDir;
    document.getElementById('ind-momentum-detail').textContent = `近期動能 ${momentum >= 0 ? '+' : ''}${momentum.toFixed(2)}%`;
}

// ============================================================
// Alerts
// ============================================================
function addAlert() {
    const threshold = parseFloat(els.alertThreshold.value);
    if (!threshold || threshold <= 0) return;

    state.alerts.push({
        id: Date.now(),
        currency: state.targetCurrency,
        threshold,
        createdAt: new Date().toLocaleDateString('zh-TW'),
    });
    saveAlerts();
    els.alertThreshold.value = '';
    renderAlerts();
    checkAlerts();
}

function removeAlert(id) {
    state.alerts = state.alerts.filter(a => a.id !== id);
    saveAlerts();
    renderAlerts();
}

function renderAlerts() {
    if (state.alerts.length === 0) {
        els.alertList.innerHTML = '<p class="empty-hint">尚未設定任何提醒</p>';
        return;
    }
    els.alertList.innerHTML = '';
    state.alerts.forEach(alert => {
        const div = document.createElement('div');
        div.className = 'alert-item';
        const curr = CURRENCIES[alert.currency] || { flag: '', name: alert.currency };
        div.innerHTML = `
            <div class="alert-item-info">
                <strong>${curr.flag} 1 ${alert.currency} &lt; ${alert.threshold.toFixed(4)} TWD</strong>
                <span>設定於 ${alert.createdAt}</span>
            </div>
            <button class="btn-danger" onclick="removeAlert(${alert.id})"><i class="fa-solid fa-trash-can"></i></button>`;
        els.alertList.appendChild(div);
    });
}

function checkAlerts() {
    state.alerts.forEach(alert => {
        const midRate = getMidRate(alert.currency);
        if (midRate && midRate <= alert.threshold) {
            const curr = CURRENCIES[alert.currency] || { name: alert.currency };
            els.alertBannerText.textContent = `${curr.name} 匯率已達標！目前 1 ${alert.currency} = ${midRate.toFixed(4)} TWD（目標 < ${alert.threshold.toFixed(4)}）`;
            els.alertBanner.classList.remove('hidden');
        }
    });
}

// ============================================================
// Multi-Expense Calculator
// ============================================================
function renderMultiExpenses() {
    els.multiExpenses.innerHTML = '';
    state.expenses.forEach((exp, idx) => {
        const div = document.createElement('div');
        div.className = 'expense-row';

        const currOptions = Object.entries(CURRENCIES).map(([code, c]) =>
            `<option value="${code}" ${code === exp.currency ? 'selected' : ''}>${c.flag} ${code}</option>`
        ).join('');

        div.innerHTML = `
            <div>
                <label>項目名稱</label>
                <input type="text" placeholder="例如: 藥妝" value="${exp.label}" data-idx="${idx}" data-field="label">
            </div>
            <div>
                <label>幣別</label>
                <select data-idx="${idx}" data-field="currency">${currOptions}</select>
            </div>
            <div>
                <label>金額</label>
                <input type="number" placeholder="0" value="${exp.amount || ''}" data-idx="${idx}" data-field="amount" min="0">
            </div>
            <button class="expense-remove" onclick="removeExpense(${idx})" title="移除"><i class="fa-solid fa-xmark"></i></button>`;

        div.querySelectorAll('input, select').forEach(el => {
            el.addEventListener('input', (e) => {
                const i = parseInt(e.target.dataset.idx);
                const field = e.target.dataset.field;
                state.expenses[i][field] = field === 'amount' ? (parseFloat(e.target.value) || 0) : e.target.value;
                calculateMultiExpenses();
            });
        });

        els.multiExpenses.appendChild(div);
    });
}

function removeExpense(idx) {
    state.expenses.splice(idx, 1);
    renderMultiExpenses();
    calculateMultiExpenses();
}

function calculateMultiExpenses() {
    const validExpenses = state.expenses.filter(e => e.amount > 0);
    if (validExpenses.length === 0) {
        els.multiResults.innerHTML = '<p class="empty-hint">新增消費項目後自動計算</p>';
        return;
    }

    // For each card, calculate total cost across all expenses
    const cardTotals = state.cards.map(card => {
        let totalCost = 0;
        let totalCashback = 0;
        validExpenses.forEach(exp => {
            const results = computeResults(exp.currency, exp.amount, [card]);
            if (results.length > 0) {
                totalCost += results[0].finalCostTwd;
                totalCashback += results[0].cashbackTwd;
            }
        });
        return { ...card, totalCost, totalCashback };
    });

    cardTotals.sort((a, b) => a.totalCost - b.totalCost);
    const best = cardTotals[0];

    let totalForeign = {};
    validExpenses.forEach(e => {
        totalForeign[e.currency] = (totalForeign[e.currency] || 0) + e.amount;
    });

    const summaryParts = Object.entries(totalForeign).map(([c, a]) => `${CURRENCIES[c]?.flag || ''} ${a.toLocaleString()} ${c}`).join(' + ');

    els.multiResults.innerHTML = `
        <div class="multi-result-card best">
            <h4>最佳方案</h4>
            <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem">${best.name}</div>
            <div class="multi-result-value">NT$ ${Math.round(best.totalCost).toLocaleString()}</div>
            <div style="font-size:0.8rem;color:var(--success);margin-top:0.25rem">回饋 NT$ ${Math.round(best.totalCashback).toLocaleString()}</div>
        </div>
        ${cardTotals.slice(1, 4).map(c => `
            <div class="multi-result-card">
                <h4>${c.name.length > 12 ? c.name.slice(0, 12) + '…' : c.name}</h4>
                <div class="multi-result-value">NT$ ${Math.round(c.totalCost).toLocaleString()}</div>
                <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem">多付 NT$ ${Math.round(c.totalCost - best.totalCost).toLocaleString()}</div>
            </div>
        `).join('')}
    `;

    if (Object.keys(totalForeign).length > 0) {
        els.multiResults.insertAdjacentHTML('beforebegin',
            document.querySelector('.multi-summary') ? '' : '');
    }
}

// ============================================================
// Start
// ============================================================
init();
