import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2?bundle';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const CANONICAL_APP_ORIGIN = 'https://yaristutkusu.teryndis.com';
const LEGACY_APP_ORIGINS = new Set([
  'https://yaristutkusu-ozel-mobil.vercel.app',
  'https://yaristutkusu.vercel.app',
  'https://yaristutkusu-yaristutkusu.vercel.app',
  'https://yaristutkusu-git-main-yaristutkusu.vercel.app',
]);
if (LEGACY_APP_ORIGINS.has(location.origin)) {
  location.replace(CANONICAL_APP_ORIGIN + location.pathname + location.search + location.hash);
  await new Promise(() => {});
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const el = (id) => document.getElementById(id);
const loading = el('loading');
const signin = el('signin');
const dashboard = el('dashboard');
const adminPanel = el('admin-panel');
const appMessage = el('app-message');
let currentMember = null;
let sessionSequence = 0;
let installPrompt = null;
let selectedDraftId = null;
let draftBusy = false;
let allForecasts = [];
let activeForecastTab = 'current';
const COMMENT_PAGE_SIZE = 15;
const commentStates = new Map();
let commentsGeneration = 0;

function commentState(publicationId) {
  if (!commentStates.has(publicationId)) {
    commentStates.set(publicationId, {
      open: false, rows: [], offset: 0, hasMore: false,
      loaded: false, loading: false, sending: false,
      draft: '', feedback: '', feedbackError: false, loadError: '', render: null,
    });
  }
  return commentStates.get(publicationId);
}

async function loadComments(publicationId, reset = false) {
  const state = commentStates.get(publicationId);
  if (!state || !currentMember || !state.open || state.loading) return;
  const sequence = sessionSequence;
  const generation = commentsGeneration;
  const isCurrent = () => sequence === sessionSequence && generation === commentsGeneration
    && commentStates.get(publicationId) === state && Boolean(currentMember);
  state.loading = true;
  state.loadError = '';
  state.render?.();
  try {
    const offset = reset ? 0 : state.offset;
    const { data, error } = await supabase.from('yt_app_comments')
      .select('id,publication_id,author_user_id,body,created_at')
      .eq('publication_id', publicationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + COMMENT_PAGE_SIZE);
    if (!isCurrent()) return;
    if (error) throw error;
    const page = (data || []).slice(0, COMMENT_PAGE_SIZE);
    const known = new Set(reset ? [] : state.rows.map(comment => comment.id));
    state.rows = reset ? page : state.rows.concat(page.filter(comment => !known.has(comment.id)));
    state.offset = offset + page.length;
    state.hasMore = (data || []).length > COMMENT_PAGE_SIZE;
    state.loaded = true;
  } catch {
    if (!isCurrent()) return;
    state.loadError = 'Yorumlar yüklenemedi. Yeniden deneyin.';
  } finally {
    if (isCurrent()) {
      state.loading = false;
      state.render?.();
    }
  }
}

async function sendComment(publicationId) {
  const state = commentStates.get(publicationId);
  if (!state || !currentMember || state.sending) return;
  const body = state.draft.trim();
  if (!body || body.length > 1000) {
    state.feedback = '1–1000 karakter arasında bir yorum yazın.';
    state.feedbackError = true;
    state.render?.();
    return;
  }
  const sequence = sessionSequence;
  const generation = commentsGeneration;
  const isCurrent = () => sequence === sessionSequence && generation === commentsGeneration
    && commentStates.get(publicationId) === state && Boolean(currentMember);
  state.sending = true;
  state.feedback = 'Yorum gönderiliyor…';
  state.feedbackError = false;
  state.render?.();
  try {
    const { error } = await supabase.from('yt_app_comments').insert({
      publication_id: publicationId,
      body,
    });
    if (!isCurrent()) return;
    if (error) throw error;
    state.draft = '';
    state.open = true;
    state.rows = [];
    state.offset = 0;
    state.hasMore = false;
    state.loaded = false;
    state.feedback = 'Yorumunuz kaydedildi.';
    state.sending = false;
    state.render?.();
    await loadComments(publicationId, true);
  } catch {
    if (!isCurrent()) return;
    state.feedback = 'Yorum gönderilemedi. Bağlantınızı ve davetli erişiminizi kontrol edin.';
    state.feedbackError = true;
  } finally {
    if (isCurrent()) {
      state.sending = false;
      state.render?.();
    }
  }
}

function createCommentBox(record) {
  const publicationId = record.id;
  const state = commentState(publicationId);
  const section = element('section', 'forecast-comments');
  const heading = element('h3', 'forecast-comment-heading', 'Yorumlar');
  const toggle = element('button', 'forecast-comment-toggle', 'Yorumları göster');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(state.open));
  const head = element('div', 'forecast-comment-head');
  head.append(heading, toggle);

  const comments = element('div', 'forecast-comment-list');
  comments.setAttribute('aria-live', 'polite');
  const form = element('form', 'forecast-comment-form');
  const label = element('label', 'forecast-comment-label', 'Yorumunu yaz');
  const textarea = element('textarea', 'forecast-comment-input');
  textarea.rows = 2;
  textarea.maxLength = 1000;
  textarea.required = true;
  textarea.placeholder = 'Bu koşu hakkında yorum yaz…';
  textarea.value = state.draft;
  label.append(textarea);
  const actions = element('div', 'forecast-comment-actions');
  const feedback = element('p', 'status-message forecast-comment-feedback');
  feedback.setAttribute('aria-live', 'polite');
  const send = element('button', 'subtle-button', 'Yorumu gönder');
  send.type = 'submit';
  actions.append(feedback, send);
  form.append(label, actions);
  section.append(head, comments, form);

  state.render = () => {
    toggle.textContent = state.open ? 'Yorumları gizle' : 'Yorumları göster';
    toggle.setAttribute('aria-expanded', String(state.open));
    if (textarea.value !== state.draft) textarea.value = state.draft;
    textarea.disabled = state.sending;
    send.disabled = state.sending || !state.draft.trim() || !currentMember;
    status(feedback, state.feedback, state.feedbackError);
    comments.replaceChildren();
    if (!state.open) {
      hide(comments);
      return;
    }
    show(comments);
    if (state.loading && !state.loaded) {
      comments.append(element('p', 'status-message', 'Yorumlar yükleniyor…'));
    }
    for (const comment of state.rows) {
      const item = element('div', 'forecast-comment-item');
      const meta = element('div', 'forecast-comment-meta');
      meta.append(element('strong', '', comment.author_user_id === currentMember?.user_id
        ? 'Siz' : 'Davetli üye'));
      const createdAt = new Date(comment.created_at);
      if (Number.isFinite(createdAt.getTime())) {
        const time = element('time', '', new Intl.DateTimeFormat('tr-TR', {
          dateStyle: 'short', timeStyle: 'short',
        }).format(createdAt));
        time.dateTime = comment.created_at;
        meta.append(time);
      }
      item.append(meta, element('p', 'forecast-comment-body', comment.body));
      comments.append(item);
    }
    if (state.loaded && !state.rows.length && !state.loading) {
      comments.append(element('p', 'status-message', 'Henüz yorum yok. İlk yorumu siz yazabilirsiniz.'));
    }
    if (state.loadError) {
      comments.append(element('p', 'status-message error', state.loadError));
      const retry = element('button', 'subtle-button', 'Yeniden dene');
      retry.type = 'button';
      retry.disabled = state.loading;
      retry.addEventListener('click', () => { void loadComments(publicationId, !state.loaded); });
      comments.append(retry);
    } else if (state.hasMore) {
      const more = element('button', 'subtle-button', 'Daha eski yorumları yükle');
      more.type = 'button';
      more.disabled = state.loading;
      more.addEventListener('click', () => { void loadComments(publicationId); });
      comments.append(more);
    }
    if (state.loaded && !state.loading && !state.loadError) {
      const refresh = element('button', 'forecast-comment-refresh', '↻ Yorumları yenile');
      refresh.type = 'button';
      refresh.addEventListener('click', () => { void loadComments(publicationId, true); });
      comments.append(refresh);
    }
  };

  toggle.addEventListener('click', () => {
    if (!currentMember) return;
    state.open = !state.open;
    state.render?.();
    if (state.open && !state.loaded && !state.loading) void loadComments(publicationId, true);
  });
  textarea.addEventListener('input', () => {
    state.draft = textarea.value;
    send.disabled = state.sending || !state.draft.trim();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    state.draft = textarea.value;
    void sendComment(publicationId);
  });
  state.render();
  return section;
}

let raceResults = new Map();
let raceResultsState = 'idle';
let resultSaving = false;
let tjkParsedResults = null;
let tjkExcludedRaces = new Set();
let pendingDetailedResult = null;
let tjkSelectionSequence = 0;
let csvPreviewRows = [];
let forecastLoadSequence = 0;
let raceResultsLoadSequence = 0;
let archiveOffset = 0;
let archiveHasMore = false;
let archiveBusy = false;

function show(element) { element.classList.remove('hidden'); }
function hide(element) { element.classList.add('hidden'); }
function status(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle('error', error);
}
function clearPrivateView() {
  ++forecastLoadSequence;
  ++raceResultsLoadSequence;
  archiveOffset = 0;
  archiveHasMore = false;
  archiveBusy = false;
  activeForecastTab = 'current';
  syncForecastTabs();
  hide(el('forecast-archive-controls'));
  hide(el('forecast-load-older'));
  hide(el('history-load-older'));
  status(el('forecast-archive-message'), '');
  el('forecast-list').replaceChildren();
  ++commentsGeneration;
  commentStates.clear();
  allForecasts = [];
  raceResults = new Map();
  raceResultsState = 'idle';
  resultSaving = false;
  pendingDetailedResult = null;
  el('comparison-summary').replaceChildren();
  el('performance-history-list').replaceChildren();
  el('history-date-filter').replaceChildren();
  appendForecastFilterOption(el('history-date-filter'), '', 'Tüm kayıtlı tarihler');
  el('history-date-filter').value = '';
  el('history-date-filter').disabled = true;
  status(el('performance-history-message'), '');
  populateRaceSelection();
  el('race-result-form').reset();
  el('result-detail-preview').replaceChildren();
  csvPreviewRows = [];
  el('result-csv-file').value = '';
  el('result-csv-preview').replaceChildren();
  status(el('result-csv-message'), '');
  tjkParsedResults = null;
  tjkExcludedRaces.clear();
  ++tjkSelectionSequence;
  el('tjk-results-list').replaceChildren();
  hide(el('tjk-batch-panel'));
  status(el('tjk-batch-message'), '');
  status(el('tjk-batch-hint'), '');
  status(el('tjk-results-message'), '');
  el('tjk-csv-file').value = '';
  el('tjk-csv-report').value = '';
  hide(el('tjk-csv-report'));
  status(el('tjk-csv-inspect-message'), '');
  el('result-save').disabled = false;
  status(el('race-result-message'), '');
  populateForecastFilters([]);
  status(el('forecast-filter-message'), '');
  el('reset-forecast-filters').disabled = true;
  el('member-list').replaceChildren();
  el('draft-list').replaceChildren();
  el('manual-publication-list').replaceChildren();
  el('manual-publications-count').textContent = '—';
  el('manual-publications-accordion').open = false;
  status(el('manual-publication-message'), '');
  el('publication-history-list').replaceChildren();
  el('publication-history-count').textContent = '—';
  el('publication-history-accordion').open = false;
  status(el('publication-history-message'), '');
  resetDraftForm();
  setDraftBusy(false);
  el('publication-count').textContent = '0';
  el('latest-day').textContent = '—';
  el('account-email').textContent = '';
}
function showSignIn(message = '', error = false) {
  clearPrivateView();
  hide(loading); hide(dashboard); hide(adminPanel); show(signin);
  if (message) { show(appMessage); status(appMessage, message, error); }
  else { hide(appMessage); status(appMessage, ''); }
}
function formatDay(day) {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function officialAgfTableUrl(record, tableNumber) {
  // TJK's dated AGF routes: 1 and 2 refer to the first and second six-leg tables.
  if (tableNumber !== 1 && tableNumber !== 2) return null;
  const cities = {
    istanbul: { name: 'İstanbul', id: '3' },
    ankara: { name: 'Ankara', id: '5' },
    adana: { name: 'Adana', id: '1' },
    bursa: { name: 'Bursa', id: '4' },
    kocaeli: { name: 'Kocaeli', id: '9' },
    izmir: { name: 'İzmir', id: '2' },
  };
  const city = cities[normalizeForecastVenue(record.venue)];
  const match = /^(20[0-9]{2})-([0-9]{2})-([0-9]{2})$/.exec(String(record.event_date || ''));
  if (!city || !match) return null;
  const date = new Date(record.event_date + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== record.event_date) return null;
  return 'https://www.tjk.org/AGFv2/' + city.id + '/'
    + match[3] + match[2] + match[1] + '/TR/' + tableNumber + '/1';
}

function officialRaceResultUrl(record) {
  // A dated, public official-result page; not a confirmation that a race has ended.
  if (!officialAgfTableUrl(record, 1)) return null;
  const cities = {
    istanbul: { name: 'İstanbul', id: '3' },
    ankara: { name: 'Ankara', id: '5' },
    adana: { name: 'Adana', id: '1' },
    bursa: { name: 'Bursa', id: '4' },
    kocaeli: { name: 'Kocaeli', id: '9' },
    izmir: { name: 'İzmir', id: '2' },
  };
  const city = cities[normalizeForecastVenue(record.venue)];
  if (!city) return null;
  const [year, month, day] = record.event_date.split('-');
  return 'https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisSonuclari?QueryParameter_Tarih='
    + encodeURIComponent(day + '/' + month + '/' + year)
    + '&SehirAdi=' + encodeURIComponent(city.name) + '&SehirId=' + city.id;
}

function createForecastCard(record, showComparison = false) {
  const card = element('article', 'forecast-card');
  const head = element('header', 'forecast-card-header');
  const headLeft = element('div');
  headLeft.append(element('div', 'race-number', record.race_number + '. Koşu'));
  headLeft.append(element('div', 'race-day', record.venue + ' · ' + formatDay(record.event_date)));
  const badge = record.model_version === 'MANUEL' ? 'ELLE GİRİLDİ' : 'MODEL ' + record.model_version;
  head.append(headLeft, element('span', 'model-badge', badge));
  const picks = element('ol', 'pick-list');
  const sorted = Array.isArray(record.picks)
    ? [...record.picks].sort((a, b) => Number(a.rank) - Number(b.rank)) : [];
  for (const pick of sorted) {
    const item = element('li');
    item.append(element('span', 'rank-pill', pick.rank));
    const info = element('div');
    const name = pick.horse_name_as_published || pick.horse_name || '';
    info.append(element('span', 'horse-no', pick.runner_number + (name ? '  ' : '')));
    if (name) info.append(element('span', 'horse-name', name));
    item.append(info);
    picks.append(item);
  }
  card.append(head, picks);
  if (showComparison) {
    const outcome = element('div', 'forecast-result');
    const saved = raceResults.get(record.id);
    if (raceResultsState !== 'ready') {
      outcome.append(element('p', '', raceResultsState === 'error'
        ? 'Sonuç bilgisi şu anda alınamadı.'
        : 'Sonuç kayıtları yükleniyor…'));
    } else if (!saved) {
      outcome.append(element('p', '', 'Sonuç kaydı bekleniyor.'));
    } else {
      const order = recordedWinnerRank(record, saved.winner_runner_number);
      outcome.append(element('strong', '', 'Kazanan: ' + saved.winner_runner_number + ' numara'));
      outcome.append(element('p', '', order >= 1 && order <= 5
        ? 'Tahminimizdeki yeri: ' + order + '. sıra'
        : 'Kazanan, ilk 5 tercihimizde yok.'));
      const details = validPickResults(saved.pick_results);
      if (details) {
        const comparison = element('ol', 'result-pick-list');
        for (const detail of details) {
          const pick = sorted.find(item => Number(item.runner_number) === detail.runner_number);
          const item = element('li');
          item.append(element('span', 'result-pick-name', detail.forecast_rank + '. tercih · '
            + detail.runner_number + (pick?.horse_name_as_published ? ' ' + pick.horse_name_as_published : '')),
          element('strong', detail.status === 'did_not_run' ? 'result-did-not-run' : '',
            detail.status === 'did_not_run' ? 'Koşmadı' : detail.finish_position + '.'));
          comparison.append(item);
        }
        outcome.append(comparison);
      }
      outcome.append(element('p', '', 'Yönetici tarafından girildi; otomatik doğrulanmadı.'));
      const officialUrl = officialRaceResultUrl(record);
      if (officialUrl) {
        const link = element('a', '', 'TJK resmî sonucunu kontrol et ↗');
        link.href = officialUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        outcome.append(link);
      }
    }
    card.append(outcome);
    card.append(createCommentBox(record));
  }
  const firstAgfUrl = officialAgfTableUrl(record, 1);
  const secondAgfUrl = officialAgfTableUrl(record, 2);
  if (firstAgfUrl && secondAgfUrl) {
    const footer = element('div', 'forecast-card-footer');
    const description = element('div', 'agf-source-note',
      'AGF yüzdeleri bu uygulamaya aktarılmıyor. TJK tabloları henüz yayımlanmamış olabilir.');
    const actions = element('div', 'agf-source-actions');
    for (const [label, url] of [['1. AGF tablosu ↗', firstAgfUrl], ['2. AGF tablosu ↗', secondAgfUrl]]) {
      const link = element('a', 'subtle-button agf-source-link', label);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.append(link);
    }
    footer.append(description, actions);
    card.append(footer);
  }
  return card;
}

function validPickResults(value) {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const seenRanks = new Set();
  const seenNumbers = new Set();
  const rows = [];
  for (const raw of value) {
    const forecastRank = Number(raw?.forecast_rank);
    const runnerNumber = Number(raw?.runner_number);
    const statusValue = raw?.status;
    const finishPosition = raw?.finish_position === null ? null : Number(raw?.finish_position);
    if (!Number.isInteger(forecastRank) || forecastRank < 1 || forecastRank > 5 || seenRanks.has(forecastRank)
        || !Number.isInteger(runnerNumber) || runnerNumber < 1 || runnerNumber > 999 || seenNumbers.has(runnerNumber)
        || !['finished', 'did_not_run'].includes(statusValue)
        || (statusValue === 'finished' && (!Number.isInteger(finishPosition) || finishPosition < 1 || finishPosition > 999))
        || (statusValue === 'did_not_run' && finishPosition !== null)) return null;
    seenRanks.add(forecastRank);
    seenNumbers.add(runnerNumber);
    rows.push({ forecast_rank: forecastRank, runner_number: runnerNumber,
      status: statusValue, finish_position: finishPosition });
  }
  return rows.sort((a, b) => a.forecast_rank - b.forecast_rank);
}
function normalizeForecastVenue(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

function appendForecastFilterOption(select, value, label) {
  const option = element('option', '', label);
  option.value = value;
  select.append(option);
}

function turkeyToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function forecastsForActiveTab(records = allForecasts) {
  const today = turkeyToday();
  return records.filter(record => activeForecastTab === 'previous'
    ? record.event_date < today
    : record.event_date >= today);
}

function syncForecastTabs() {
  for (const [id, tab] of [['current-forecasts-tab', 'current'], ['previous-forecasts-tab', 'previous']]) {
    const button = el(id);
    const selected = activeForecastTab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function selectForecastTab(tab) {
  if (!['current', 'previous'].includes(tab) || activeForecastTab === tab) return;
  activeForecastTab = tab;
  syncForecastTabs();
  populateForecastFilters(forecastsForActiveTab());
  applyForecastFilters();
}

function populateForecastFilters(records) {
  const daySelect = el('forecast-date-filter');
  const venueSelect = el('forecast-venue-filter');
  const raceSelect = el('forecast-race-filter');
  const previousDay = daySelect.value;
  const previousVenue = venueSelect.value;
  const previousRace = raceSelect.value;
  const days = [...new Set(records.map(record => record.event_date))].sort().reverse();
  const races = [...new Set(records.map(record => String(record.race_number)))].sort((a, b) => Number(a) - Number(b));
  const venues = new Map();
  for (const record of records) {
    const venue = String(record.venue || '').trim();
    const key = normalizeForecastVenue(venue);
    if (key && !venues.has(key)) venues.set(key, venue);
  }
  daySelect.replaceChildren();
  appendForecastFilterOption(daySelect, '', 'Tüm tarihler');
  for (const day of days) appendForecastFilterOption(daySelect, day, formatDay(day));
  venueSelect.replaceChildren();
  appendForecastFilterOption(venueSelect, '', 'Tüm hipodromlar');
  for (const [key, label] of [...venues].sort((a, b) => a[1].localeCompare(b[1], 'tr-TR'))) {
    appendForecastFilterOption(venueSelect, key, label);
  }
  raceSelect.replaceChildren();
  appendForecastFilterOption(raceSelect, '', 'Tüm koşular');
  for (const race of races) appendForecastFilterOption(raceSelect, race, race + '. koşu');
  daySelect.value = days.includes(previousDay) ? previousDay : '';
  venueSelect.value = venues.has(previousVenue) ? previousVenue : '';
  raceSelect.value = races.includes(previousRace) ? previousRace : '';
}

function recordedWinnerRank(record, winnerRunnerNumber) {
  const winner = Number(winnerRunnerNumber);
  if (!Number.isInteger(winner) || winner < 1 || winner > 999) return 0;
  const picks = Array.isArray(record.picks) ? record.picks : [];
  const rank = Number(picks.find(pick => Number(pick.runner_number) === winner)?.rank);
  return Number.isInteger(rank) && rank >= 1 && rank <= 5 ? rank : 0;
}

function summarizeRecordedForecasts(records) {
  const ranks = [0, 0, 0, 0, 0, 0];
  let recorded = 0;
  for (const record of records) {
    if (!raceResults.has(record.id)) continue;
    recorded++;
    ranks[recordedWinnerRank(record, raceResults.get(record.id)?.winner_runner_number)]++;
  }
  return { published: records.length, recorded, ranks, topFive: recorded - ranks[0] };
}

function renderComparisonSummary(records) {
  const root = el('comparison-summary');
  root.replaceChildren();
  if (!records.length) return;
  if (raceResultsState !== 'ready') {
    root.append(element('p', 'status-message', raceResultsState === 'error'
      ? 'Karşılaştırma sonuçları alınamadı. Yenile ile yeniden deneyin.'
      : 'Karşılaştırma sonuçları yükleniyor…'));
    return;
  }
  const metrics = summarizeRecordedForecasts(records);
    const group = element('section', 'comparison-group');
    const header = element('div', 'comparison-group-header');
    header.append(element('h3', 'comparison-group-title', 'Tüm tahminler'),
      element('span', 'comparison-group-count',
        metrics.published ? metrics.recorded + ' / ' + metrics.published + ' sonucu girildi' : 'Yayın yok'));
    group.append(header);
    if (!metrics.published || !metrics.recorded) {
      group.append(element('p', 'comparison-group-empty',
        metrics.published ? 'Bu grupta sonucu kaydedilmiş koşu yok.' : 'Bu filtrede yayımlanmış tahmin yok.'));
    } else {
      const stats = element('div', 'comparison-group-stats');
      for (const [label, count] of [
        ['İlk tercih kazandı', metrics.ranks[1]],
        ['Kazanan ilk 5 içinde', metrics.topFive],
        ['Kazanan ilk 5 dışında', metrics.ranks[0]],
      ]) {
        const chip = element('div', 'comparison-chip');
        chip.append(element('span', '', label),
          element('strong', '', count + ' / ' + metrics.recorded));
        stats.append(chip);
      }
      group.append(stats);
      const distribution = element('div', 'comparison-rank-breakdown');
      distribution.append(element('span', 'comparison-rank-heading', 'Kazananın tercih sırası'));
      for (let rank = 1; rank <= 5; rank++) {
        distribution.append(element('span', 'comparison-rank-item',
          rank + '. sıra: ' + metrics.ranks[rank]));
      }
      group.append(distribution);
    }
  root.append(group);
  root.append(element('p', 'comparison-note',
    'Yalnızca yüklenmiş ve seçili filtreye uyan yayımlanmış tahminler gösterilir. Başarı sayımlarında payda yalnızca sonucu kaydedilmiş koşulardır; sonucu beklenenler hesaba katılmaz. Model 2.2 ve manuel tercihler birlikte değerlendirilir. Sonuçlar yönetici tarafından kaydedilmiş, otomatik doğrulanmamıştır.'));
}


function raceMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !['Kum', 'Sentetik', 'Çim'].includes(value.surface)
      || !Number.isInteger(value.distance_m) || value.distance_m < 800 || value.distance_m > 4000
      || typeof value.race_type !== 'string' || !value.race_type.trim()
      || value.race_type.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(value.race_type)) return null;
  return { surface: value.surface, distance_m: value.distance_m,
    race_type: value.race_type.trim().replace(/\s+/g, ' ') };
}

function parseTjkRaceMetadata(headerLine) {
  const fields = parseTjkCsvLine(headerLine).map(field => field.trim());
  const raceType = fields[1] || '';
  const surfaces = fields.slice(2).map(value => ({
    kum: 'Kum', sentetik: 'Sentetik', cim: 'Çim',
  })[normalizeTjkHeader(value)]).filter(Boolean);
  const distances = fields.slice(2).map(value => /^\s*(\d{3,4})\s*m\s*$/i.exec(value))
    .filter(Boolean).map(match => Number(match[1]));
  if (surfaces.length !== 1 || distances.length !== 1) return null;
  return raceMetadata({ surface: surfaces[0], distance_m: distances[0], race_type: raceType });
}

function raceClassLabel(value) {
  return String(value || '').split('/')[0].trim();
}

function renderRaceBreakdown(records) {
  const root = el('race-breakdown-list');
  root.replaceChildren();
  const completed = records.filter(record => raceResults.has(record.id));
    const classified = completed.map(record => {
      const result = raceResults.get(record.id);
      const metadata = raceMetadata({ surface: result.race_surface,
        distance_m: result.race_distance_m, race_type: result.race_type });
      return metadata ? { record, metadata, rank: recordedWinnerRank(record, result.winner_runner_number) } : null;
    }).filter(Boolean);
    const section = element('section', 'race-breakdown-model');
    section.append(element('h4', '', 'Tüm tahminler'));
    section.append(element('p', 'race-breakdown-coverage',
      classified.length + ' / ' + completed.length
      + ' sonuçlu koşuda TJK CSV pist, mesafe ve koşu türü bilgisi var.'));
    if (!classified.length) {
      section.append(element('p', 'race-breakdown-empty', completed.length
        ? 'Bu gruptaki sonuçlar için resmî koşu sınıflandırması henüz kaydedilmedi.'
        : 'Bu grupta kayıtlı sonuç yok.'));
    } else {
    for (const [heading, groupOf] of [
      ['Pist', item => item.metadata.surface],
      ['Mesafe', item => item.metadata.distance_m + ' m'],
      ['Koşu türü', item => raceClassLabel(item.metadata.race_type)],
    ]) {
      const headingNode = element('h5', 'race-breakdown-title', heading);
      const table = element('table', 'race-breakdown-table');
      const thead = element('thead');
      const top = element('tr');
      for (const name of ['Kategori', 'Koşu', 'İlk 1', 'İlk 3', 'İlk 5']) {
        const th = element('th', '', name);
        th.scope = 'col';
        top.append(th);
      }
      thead.append(top);
      table.append(thead);
      const tbody = element('tbody');
      const grouped = new Map();
      for (const item of classified) {
        const key = groupOf(item);
        if (!grouped.has(key)) grouped.set(key, { n: 0, one: 0, three: 0, five: 0 });
        const x = grouped.get(key);
        x.n++;
        if (item.rank === 1) x.one++;
        if (item.rank > 0 && item.rank <= 3) x.three++;
        if (item.rank > 0 && item.rank <= 5) x.five++;
      }
      for (const [name, x] of [...grouped.entries()].sort((a, b) =>
        String(a[0]).localeCompare(String(b[0]), 'tr-TR', { numeric: true }))) {
        const tr = element('tr');
        const title = element('th', '', name);
        title.scope = 'row';
        tr.append(title, element('td', '', x.n));
        for (const score of [x.one, x.three, x.five]) {
          tr.append(element('td', '', score + '/' + x.n
            + ' (' + Math.round(100 * score / x.n) + '%)'));
        }
        tbody.append(tr);
      }
      table.append(tbody);
      const scroll = element('div', 'race-breakdown-scroll');
      scroll.append(table);
      section.append(headingNode, scroll);
    }
    }
  root.append(section);
  root.append(element('p', 'performance-footnote',
    'Yalnızca kaydedilmiş sonuçlar ve TJK CSV başlığından alınmış kategoriler sayılır. '
    + 'Eksik kategori bilgisi tahmin edilmez. Örneklem küçükken yüzdeler genellenemez; '
    + 'Model 2.2 ile manuel değerlendirmeler birlikte gösterilir.'));
}

function renderPerformanceHistory() {
  const root = el('performance-history-list');
  const filter = el('history-date-filter');
  const message = el('performance-history-message');
  root.replaceChildren();
  el('race-breakdown-list').replaceChildren();
  if (!currentMember) {
    filter.disabled = true;
    status(message, '');
    return;
  }
  if (raceResultsState !== 'ready') {
    filter.disabled = true;
    status(message, raceResultsState === 'error'
      ? 'Geçmiş sonuçlar alınamadı. Yenile ile yeniden deneyin.'
      : 'Geçmiş sonuçlar yükleniyor…', raceResultsState === 'error');
    return;
  }
  const recorded = allForecasts.filter(record => raceResults.has(record.id));
  const days = [...new Set(recorded.map(record => record.event_date))].sort().reverse();
  const selected = filter.value;
  filter.replaceChildren();
  appendForecastFilterOption(filter, '', 'Tüm kayıtlı tarihler');
  for (const day of days) appendForecastFilterOption(filter, day, formatDay(day));
  filter.value = days.includes(selected) ? selected : '';
  filter.disabled = !days.length;
  if (!recorded.length) {
    renderRaceBreakdown([]);
    status(message, 'Henüz kayıtlı yarış sonucu yok. Sonucu beklenen koşular geçmişe eklenmez.');
    return;
  }
  const visible = recorded.filter(record => !filter.value || record.event_date === filter.value)
    .sort((a, b) => b.event_date.localeCompare(a.event_date)
      || a.venue.localeCompare(b.venue, 'tr-TR')
      || Number(a.race_number) - Number(b.race_number));
  renderRaceBreakdown(visible);
  const groups = new Map();
  for (const record of visible) {
    if (!groups.has(record.event_date)) groups.set(record.event_date, []);
    groups.get(record.event_date).push(record);
  }
  for (const [day, races] of groups) {
    const panel = element('details', 'performance-day');
    const header = element('summary', 'performance-day-heading performance-day-summary');
    header.append(element('h3', '', formatDay(day)),
      element('span', '', races.length + ' sonuçlu tahmin'));
    panel.append(header);
    panel.addEventListener('toggle', () => {
      if (!panel.open) return;
      for (const other of root.querySelectorAll('details.performance-day')) {
        if (other !== panel) other.open = false;
      }
    });

    const body = element('div', 'performance-day-body');
    const stats = summarizeRecordedForecasts(races);
    const group = element('div', 'performance-model-group');
    const heading = element('div', 'performance-model-heading');
    heading.append(element('strong', '', 'Tüm tahminler'),
      element('span', '', stats.recorded + ' sonuç · İlk tercih: '
        + stats.ranks[1] + '/' + stats.recorded
        + ' · İlk 5: ' + stats.topFive + '/' + stats.recorded));
    group.append(heading);

    for (const record of races) {
      const result = raceResults.get(record.id);
      const rank = recordedWinnerRank(record, result.winner_runner_number);
      const item = element('details', 'performance-race');
      const raceSummary = element('summary', 'performance-race-summary');
      raceSummary.append(
        element('strong', '', record.venue + ' · ' + record.race_number + '. koşu'),
        element('span', 'performance-race-summary-status',
          rank ? rank + '. sıra' : 'İlk 5 dışı'),
      );
      item.append(raceSummary);

      const raceBody = element('div', 'performance-race-body');
      raceBody.append(element('span', '', 'Kazanan: ' + result.winner_runner_number
        + ' numara · ' + (rank ? 'Tahminde ' + rank + '. sıra' : 'İlk 5 tercih dışında')));
      const official = officialRaceResultUrl(record);
      if (official) {
        const link = element('a', 'performance-result-link', 'TJK sonucu ↗');
        link.href = official;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        raceBody.append(link);
      }
      item.append(raceBody);
      group.append(item);
    }

    body.append(group);
    panel.append(body);
    root.append(panel);
  }
  status(message, visible.length + ' sonuçlu tahmin · ' + groups.size
    + ' yarış günü gösteriliyor. Sonuçlar yönetici tarafından kaydedilmiştir; otomatik doğrulanmamıştır.');
}

function populateRaceSelection() {
  const selector = el('result-publication');
  const prior = selector.value;
  selector.replaceChildren();
  appendForecastFilterOption(selector, '', 'Koşu seç');
  for (const record of allForecasts) {
    appendForecastFilterOption(selector, record.id,
      formatDay(record.event_date) + ' · ' + record.venue + ' · ' + record.race_number + '. koşu');
  }
  selector.value = allForecasts.some(record => record.id === prior) ? prior : '';
  syncResultEditor();
}

function syncResultEditor() {
  const publication = allForecasts.find(record => record.id === el('result-publication').value);
  if (!publication || pendingDetailedResult?.publication_id !== publication.id) pendingDetailedResult = null;
  const link = el('result-official-link');
  const url = publication && officialRaceResultUrl(publication);
  if (url) {
    link.href = url;
    show(link);
  } else {
    link.removeAttribute('href');
    hide(link);
  }
  const previous = publication && raceResults.get(publication.id);
  el('result-winner').value = previous ? String(previous.winner_runner_number) : '';
  el('result-confirm').checked = false;
  renderPendingDetailedResult(publication);
  status(el('race-result-message'), previous
    ? 'Kayıtlı kazanan: ' + previous.winner_runner_number + '. Değiştirir veya ayrıntı eklersen eski değer işlem geçmişinde saklanır.' : '');
}

function renderPendingDetailedResult(record) {
  const root = el('result-detail-preview');
  root.replaceChildren();
  const details = record && pendingDetailedResult?.publication_id === record.id
    ? validPickResults(pendingDetailedResult.pick_results) : null;
  if (!details) return;
  root.append(element('strong', 'result-detail-title', 'CSV ayrıntılı karşılaştırma önizlemesi'));
  const list = element('ol', 'result-pick-list');
  const picks = Array.isArray(record.picks) ? record.picks : [];
  for (const detail of details) {
    const pick = picks.find(item => Number(item.runner_number) === detail.runner_number);
    const item = element('li');
    item.append(element('span', 'result-pick-name', detail.forecast_rank + '. tercih · '
      + detail.runner_number + (pick?.horse_name_as_published ? ' ' + pick.horse_name_as_published : '')),
    element('strong', detail.status === 'did_not_run' ? 'result-did-not-run' : '',
      detail.status === 'did_not_run' ? 'Koşmadı' : detail.finish_position + '.'));
    list.append(item);
  }
  root.append(list);
}

function parseResultPreviewCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .split('\n').map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(row => row.raw);
  if (!lines.length || lines[0].raw !== 'tarih;hipodrom;kosu;kazanan_no') {
    throw new Error('Beklenen CSV başlığı: tarih;hipodrom;kosu;kazanan_no. TJK dosya biçimi otomatik olarak çözümlenmez.');
  }
  if (lines.length < 2) throw new Error('CSV dosyasında sonuç satırı bulunmuyor.');
  if (lines.length > 51) throw new Error('Bir defada en fazla 50 sonuç satırı önizlenebilir.');
  const counts = new Map();
  const rows = lines.slice(1).map(({ raw, line }) => {
    const parts = raw.split(';').map(part => part.trim());
    if (parts.length !== 4 || parts.some(part => !part || /["\u0000-\u001f\u007f]/.test(part))) {
      return { line, error: 'Dört geçerli alan gerekli; tırnaklı veya çok satırlı CSV desteklenmiyor.' };
    }
    const [date, venue, raceText, winnerText] = parts;
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00Z') : null;
    if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
        || parsed.getUTCFullYear() < 2000 || parsed.getUTCFullYear() > 2100) {
      return { line, error: 'Tarih YYYY-AA-GG biçiminde ve geçerli olmalı.' };
    }
    const venueKey = normalizeForecastVenue(venue);
    if (!['istanbul', 'ankara'].includes(venueKey)) {
      return { line, error: 'Yalnızca İstanbul ve Ankara hipodromları destekleniyor.' };
    }
    const race = Number(raceText);
    const winner = Number(winnerText);
    if (!/^[1-9]\d*$/.test(raceText) || !Number.isInteger(race) || race > 30
        || !/^[1-9]\d*$/.test(winnerText) || !Number.isInteger(winner) || winner > 999) {
      return { line, error: 'Koşu 1–30 ve kazanan at numarası 1–999 aralığında olmalı.' };
    }
    const key = [date, venueKey, race].join('|');
    counts.set(key, (counts.get(key) || 0) + 1);
    return { line, date, venue, race, winner, key };
  });
  return rows.map(row => row.key && counts.get(row.key) > 1
    ? { ...row, error: 'CSV içinde aynı koşu tekrarlanmış; iki satır da engellendi.' }
    : row);
}

function renderResultCsvPreview() {
  const root = el('result-csv-preview');
  root.replaceChildren();
  if (!csvPreviewRows.length) return;
  if (raceResultsState !== 'ready') {
    status(el('result-csv-message'), 'Kayıtlı sonuçlar yüklenmeden CSV eşleştirmesi kullanılamaz.', true);
    return;
  }
  let available = 0;
  for (const row of csvPreviewRows) {
    const item = element('div', 'draft-row');
    const info = element('div');
    info.append(element('div', 'draft-row-title', row.error
      ? row.line + '. satır'
      : row.line + '. satır · ' + row.date + ' · ' + row.venue + ' · ' + row.race + '. koşu · ' + row.winner + ' numara'));
    let note = row.error || '';
    if (!note) {
      const matches = allForecasts.filter(record => record.event_date === row.date
        && normalizeForecastVenue(record.venue) === normalizeForecastVenue(row.venue)
        && Number(record.race_number) === row.race);
      if (matches.length !== 1 || !officialRaceResultUrl(matches[0])) {
        note = 'Yayımlanmış tahminle benzersiz eşleşme bulunamadı; aktarım engellendi.';
      } else if (raceResults.has(matches[0].id)) {
        note = 'Bu koşunun sonucu zaten kayıtlı; düzeltme için mevcut sonuç formunu kullan.';
      } else {
        note = 'Eşleşti; resmî TJK sonucunu ayrıca kontrol etmeden kaydetme.';
        available++;
        const button = element('button', 'subtle-button', 'Formda aç');
        button.type = 'button';
        button.disabled = resultSaving;
        button.addEventListener('click', () => {
          if (currentMember?.role !== 'owner' || raceResultsState !== 'ready'
              || raceResults.has(matches[0].id) || resultSaving) return;
          el('result-publication').value = matches[0].id;
          syncResultEditor();
          el('result-winner').value = String(row.winner);
          status(el('race-result-message'), 'CSV satırı forma aktarıldı. Resmî TJK sonucunu kontrol et; onay kutusu işaretlenmeden kayıt yapılmaz.');
          el('race-result-form').scrollIntoView({ block: 'start' });
        });
        item.append(button);
      }
    }
    info.append(element('div', 'draft-row-meta', note));
    item.prepend(info);
    root.append(item);
  }
  status(el('result-csv-message'), csvPreviewRows.length + ' satır kontrol edildi; '
    + available + ' satır forma aktarılabilir. Dosya sunucuya gönderilmez.');
}

async function previewResultCsvFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const sequence = sessionSequence;
  csvPreviewRows = [];
  el('result-csv-preview').replaceChildren();
  event.target.value = '';
  if (currentMember?.role !== 'owner') return;
  if (!/\.csv$/i.test(file.name) || file.size > 65536) {
    status(el('result-csv-message'), 'En fazla 64 KB büyüklüğünde bir .csv dosyası seç.', true);
    return;
  }
  try {
    const content = await file.text();
    if (sequence !== sessionSequence || currentMember?.role !== 'owner') return;
    if (content.includes('\uFFFD')) throw new Error('Dosya UTF-8 biçiminde okunamadı; otomatik dönüştürme yapılmadı.');
    csvPreviewRows = parseResultPreviewCsv(content);
    renderResultCsvPreview();
  } catch (error) {
    if (sequence !== sessionSequence || currentMember?.role !== 'owner') return;
    csvPreviewRows = [];
    status(el('result-csv-message'), error.message || 'CSV dosyası okunamadı.', true);
  }
}


function parseTjkCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      fields.push(field.trim()); field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Kapanmamış tırnak içeren CSV satırı var.');
  fields.push(field.trim());
  return fields;
}

function normalizeTjkHeader(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

// The TJK result's "At No" column numbers rows in finish order, NOT published runners.
function normalizeTjkHorseName(value) {
  return String(value || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

const TJK_EQUIPMENT_SUFFIX = new Set(['kg', 'k', 'db', 'sk', 'skg', 'gkr', 'skgsk', 'sgkr', 'kosmaz']);
function tjkHorseNameMatches(resultName, publishedName) {
  const result = normalizeTjkHorseName(resultName);
  const published = normalizeTjkHorseName(publishedName);
  if (!published) return false;
  if (result === published) return true;
  if (!result.startsWith(published + ' ')) return false;
  const suffix = result.slice(published.length + 1).split(' ');
  return suffix.length <= 7 && suffix.every(token => TJK_EQUIPMENT_SUFFIX.has(token));
}

function parseOfficialTjkResults(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const header = /^([^;\n]{1,80});([^;\n]{1,120});\s*(\d{2})\/(\d{2})\/(\d{4})\s*;?\s*$/
    .exec(lines.find(line => line.trim())?.trim() || '');
  if (!header) throw new Error('TJK tarih ve hipodrom başlığı tanınmadı.');
  const venue = ({ istanbul: 'İstanbul', ankara: 'Ankara', adana: 'Adana', bursa: 'Bursa', kocaeli: 'Kocaeli', izmir: 'İzmir' })[normalizeForecastVenue(header[1])];
  const eventDate = header[5] + '-' + header[4] + '-' + header[3];
  const date = new Date(eventDate + 'T12:00:00Z');
  if (!venue || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== eventDate
      || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) {
    throw new Error('TJK tarihi veya hipodromu doğrulanamadı.');
  }
  const sections = [];
  let current = null;
  for (const rawLine of lines.slice(1)) {
    const race = /^\s*(\d{1,2})\.\s*Ko[şs]u\s*:/i.exec(rawLine);
    if (race) {
      if (current) sections.push(current);
      current = { race_number: Number(race[1]), payouts: [], headers: null, degreeIndex: -1,
        race_metadata: parseTjkRaceMetadata(rawLine), runners: [], invalid: false };
      continue;
    }
    if (!current) continue;
    // The main GANYAN payout can follow an "eküridir." note, while multi-leg payouts must be ignored.
    const payouts = [...rawLine.matchAll(/\bGANYAN\s*\(\s*([1-9]\d{0,2})\s*\)\s*:/gi)];
    if (payouts.length) {
      if (/^\s*[1-9]\d*;/.test(rawLine)) current.invalid = true;
      current.payouts.push(...payouts.map(match => Number(match[1])));
      continue;
    }
    if (!rawLine.trim()) continue;
    let fields;
    try { fields = parseTjkCsvLine(rawLine); } catch { current.invalid = true; continue; }
    if (normalizeTjkHeader(fields[0]) === 'atno' && normalizeTjkHeader(fields[1]) === 'atismi') {
      if (current.headers) { current.invalid = true; continue; }
      current.headers = fields;
      current.degreeIndex = fields.findIndex(value => normalizeTjkHeader(value) === 'derece');
      if (current.degreeIndex < 2) current.invalid = true;
      continue;
    }
    if (!current.headers) continue;
    if (fields.length !== current.headers.length) { current.invalid = true; continue; }
    const orderText = fields[0];
    if (!/^[1-9]\d{0,2}$/.test(orderText) || !fields[1]) { current.invalid = true; continue; }
    const degree = fields[current.degreeIndex] || '';
    const degreeKey = normalizeTjkHeader(degree);
    const didNotRun = degreeKey === 'kosmaz' || degreeKey === 'kosmadi';
    const unplaced = degreeKey === 'derecesiz';
    const finished = /^\d{1,2}[.:]\d{2}[.:]\d{2}$/.test(degree);
    if (!didNotRun && !unplaced && !finished) current.invalid = true;
    if (normalizeTjkHorseName(fields[1]).endsWith(' kosmaz') && !didNotRun) current.invalid = true;
    current.runners.push({
      result_order: Number(orderText),
      horse_name: fields[1],
      status: didNotRun ? 'did_not_run' : (finished ? 'finished' : (unplaced ? 'unplaced' : 'unknown')),
      finish_position: finished ? Number(orderText) : null,
    });
  }
  if (current) sections.push(current);
  if (!sections.length || sections.length > 30) throw new Error('TJK koşu bölümleri tanınmadı.');
  const counts = new Map();
  for (const section of sections) counts.set(section.race_number, (counts.get(section.race_number) || 0) + 1);
  const rows = sections.map(section => {
    let warning = '';
    const finishers = section.runners.filter(item => item.status === 'finished');
    const names = section.runners.map(item => normalizeTjkHorseName(item.horse_name));
    if (section.race_number < 1 || section.race_number > 30 || counts.get(section.race_number) > 1)
      warning = 'Koşu başlığı geçersiz veya tekrarlanmış.';
    else if (!section.headers || section.degreeIndex < 2) warning = 'At tablosunda Derece sütunu yok; sonuç aktarılamaz.';
    else if (section.invalid || new Set(names).size !== names.length
        || section.runners.some((item, index) => item.result_order !== index + 1))
      warning = 'At tablosunda eksik, yinelenen veya çelişkili satır var.';
    else if (!finishers.length || finishers.some((item, index) => item.finish_position !== index + 1)
        || section.runners.some(item => item.status === 'unknown'))
      warning = 'Bitiriş sırası veya Koşmadı / Derecesiz durumu açık olmayan at var.';
    else if (section.payouts.length !== 1) warning = 'Tek bir geçerli GANYAN sonucu bulunamadı.';
    return { race_number: section.race_number, winner: warning ? null : section.payouts[0],
      runners: warning ? [] : section.runners, race_metadata: section.race_metadata, warning };
  });
  return { event_date: eventDate, venue, rows };
}

function publishedPickNameState(record) {
  const picks = Array.isArray(record?.picks) ? record.picks : [];
  if (picks.length !== 5) return 'invalid';
  const named = picks.filter(pick => String(
    pick?.horse_name_as_published || pick?.horse_name || '').trim()).length;
  return named === 5 ? 'complete' : (named === 0 ? 'absent' : 'partial');
}

function buildDetailedPickResults(record, row) {
  const picks = Array.isArray(record?.picks) ? [...record.picks].sort((a, b) => Number(a.rank) - Number(b.rank)) : [];
  if (picks.length !== 5 || !Array.isArray(row?.runners) || !Number.isInteger(row.winner)) return null;
  const first = row.runners.find(item => item.status === 'finished');
  if (!first || first.finish_position !== 1) return null;
  const results = [];
  const matchedRunners = new Set();
  for (const pick of picks) {
    const matches = row.runners.filter(item => tjkHorseNameMatches(
      item.horse_name, pick.horse_name_as_published || pick.horse_name));
    if (matches.length !== 1 || matchedRunners.has(matches[0])) return null;
    const runner = matches[0];
    matchedRunners.add(runner);
    // Published pick numbers and the official GANYAN must agree when the winner was picked.
    if (runner === first && Number(pick.runner_number) !== row.winner) return null;
    if (Number(pick.runner_number) === row.winner && runner !== first) return null;
    // "Derecesiz" has no verified placing. Never invent a finish position for a picked horse.
    if (!['finished', 'did_not_run'].includes(runner.status)) return null;
    results.push({ forecast_rank: Number(pick.rank), runner_number: Number(pick.runner_number),
      status: runner.status, finish_position: runner.finish_position });
  }
  return validPickResults(results);
}


function prepareTjkBulkBatch() {
  if (currentMember?.role !== 'owner' || raceResultsState !== 'ready' || !tjkParsedResults) {
    return { error: 'Önizleme ve kayıtlı sonuçlar hazır değil.', entries: [], remaining: 0, unchanged: 0 };
  }
  const rows = tjkParsedResults.rows;
  if (!rows.length || rows.length > 12) {
    return { error: 'Toplu kayıt için 1–12 koşuluk tek TJK CSV dosyası gerekli.', entries: [], remaining: 0, unchanged: 0 };
  }
  const entries = [];
  const seen = new Set();
  let remaining = 0;
  let unchanged = 0;
  let skipped = 0;
  let metadataMissing = 0;
  let winnerOnly = 0;
  for (const row of rows) {
    if (tjkExcludedRaces.has(row.race_number)) { skipped++; continue; }
    if (row.warning || !Number.isInteger(row.winner) || row.winner < 1 || row.winner > 999) {
      return { error: row.race_number + '. koşu doğrulanamadı. Toplu kayıt kapatıldı.', entries: [], remaining: 0, unchanged: 0 };
    }
    const matches = allForecasts.filter(record => record.event_date === tjkParsedResults.event_date
      && normalizeForecastVenue(record.venue) === normalizeForecastVenue(tjkParsedResults.venue)
      && Number(record.race_number) === row.race_number);
    const record = matches.length === 1 ? matches[0] : null;
    if (!record || seen.has(record.id) || !officialRaceResultUrl(record)) {
      return { error: row.race_number + '. koşu için tek bir yayımlanmış tahmin bulunamadı.', entries: [], remaining: 0, unchanged: 0 };
    }
    seen.add(record.id);
    const nameState = publishedPickNameState(record);
    if (nameState === 'invalid' || nameState === 'partial') {
      return { error: row.race_number + '. koşunun yayımlanmış at adları eksik veya kısmi; kayıt engellendi.', entries: [], remaining: 0, unchanged: 0 };
    }
    const details = nameState === 'complete' ? buildDetailedPickResults(record, row) : null;
    if (nameState === 'complete' && !details) {
      return { error: row.race_number + '. koşunun beşli karşılaştırması doğrulanamadı.', entries: [], remaining: 0, unchanged: 0 };
    }
    const saved = raceResults.get(record.id);
    const meta = raceMetadata(row.race_metadata);
    const previousMeta = saved && raceMetadata({ surface: saved.race_surface,
      distance_m: saved.race_distance_m, race_type: saved.race_type });
    if (meta && previousMeta
        && (meta.surface !== previousMeta.surface || meta.distance_m !== previousMeta.distance_m
          || meta.race_type !== previousMeta.race_type)) {
      return { error: row.race_number + '. koşunun TJK koşu bilgisi kayıtla çelişiyor.', entries: [] };
    }
    if (meta && !previousMeta) metadataMissing++;
    if (saved && Number(saved.winner_runner_number) !== row.winner) {
      return { error: row.race_number + '. koşunun kayıtlı kazananı CSV ile çelişiyor. Toplu işlem durduruldu.', entries: [], remaining: 0, unchanged: 0 };
    }
    if (saved?.pick_results != null) {
      const prior = validPickResults(saved.pick_results);
      if (!prior || (details && JSON.stringify(prior) !== JSON.stringify(details))) {
        return { error: row.race_number + '. koşunun kayıtlı ayrıntıları CSV ile çelişiyor. Tek koşu formunda kontrol et.', entries: [], remaining: 0, unchanged: 0 };
      }
      unchanged++;
    } else if (!saved || details) remaining++;
    else unchanged++;
    if (!details) winnerOnly++;
    entries.push({
      publication_id: record.id, winner_runner_number: row.winner,
      source_event_date: tjkParsedResults.event_date,
      source_venue: tjkParsedResults.venue,
      source_race_number: row.race_number,
      ...(details ? { pick_results: details } : {}),
      ...(meta ? { race_metadata: meta } : {}),
    });
  }
  if (!entries.length) {
    return { error: 'Bütün koşular Belirsiz olarak işaretli; kaydedilecek sonuç kalmadı.',
      entries: [], remaining: 0, unchanged: 0, skipped };
  }
  return { error: '', entries, remaining, unchanged, skipped, metadataMissing, winnerOnly };
}

async function saveAllTjkResults() {
  if (resultSaving || currentMember?.role !== 'owner' || raceResultsState !== 'ready') return;
  const plan = prepareTjkBulkBatch();
  if (plan.error || !plan.entries.length || (!plan.remaining && !plan.metadataMissing)) {
    status(el('tjk-batch-message'), plan.error || 'Ayrıntılar ve TJK koşu bilgileri zaten kayıtlı.', Boolean(plan.error));
    return;
  }
  const approval = formatDay(tjkParsedResults.event_date) + ' · ' + tjkParsedResults.venue
    + '\n' + plan.entries.length + ' seçili koşuyu kontrol ettim.'
    + '\n' + plan.skipped + ' belirsiz koşu atlanacak; varsa kayıtlı sonucu korunacak.'
    + '\n' + plan.remaining + ' sonuç/ayrıntı güncellemesi ve ' + plan.metadataMissing
    + ' resmî koşu başlığı kaydedilecek; mevcut sonuçlar korunacak.'
    + '\n' + plan.winnerOnly + ' koşuda yayımlanmış at adı yok; yalnız kazanan numarası ve koşu bilgisi kaydedilecek, bitiriş sırası üretilmeyecek.'
    + '\nİlk beş dışında kalan kazananları da TJK sonucundan doğruladım.'
    + '\nBir koşuda çelişki varsa hiçbir sonuç kaydedilmeyecek. Onaylıyor musun?';
  if (!window.confirm(approval)) return;
  const sequence = sessionSequence, selection = tjkSelectionSequence;
  resultSaving = true;
  el('result-save').disabled = true;
  el('tjk-csv-file').disabled = true;
  renderOfficialTjkResults();
  status(el('tjk-batch-message'), 'Seçili koşular tek işlemde kaydediliyor…');
  try {
    const response = await publicationAction({
      action: 'save_race_results_batch', confirm_official_result: true, results: plan.entries,
    });
    if (sequence !== sessionSequence || selection !== tjkSelectionSequence || currentMember?.role !== 'owner') return;
    await loadRaceResults();
    if (sequence !== sessionSequence || selection !== tjkSelectionSequence || currentMember?.role !== 'owner') return;
    const summary = response.summary;
    if (!summary || summary.total !== plan.entries.length
        || summary.inserted + summary.updated + summary.unchanged !== summary.total
        || !Number.isInteger(summary.metadata_added)) {
      status(el('tjk-batch-message'), 'Sunucu yanıtı doğrulanamadı. Sonuçları yenileyerek kontrol et.', true);
    } else {
      status(el('tjk-batch-message'), raceResultsState === 'ready'
        ? summary.total + ' seçili koşu tamamlandı · ' + plan.skipped + ' belirsiz koşu atlandı · '
          + (summary.inserted + summary.updated) + ' sonuç/ayrıntı güncellendi · '
          + summary.metadata_added + ' TJK koşu başlığı kaydedildi · '
          + summary.unchanged + ' mevcut sonuç korundu.'
        : 'Toplu işlem tamamlandı; güncel sonuçlar yüklenemedi. Sonuçları yenile.',
        raceResultsState !== 'ready');
    }
  } catch (error) {
    if (sequence === sessionSequence && selection === tjkSelectionSequence && currentMember?.role === 'owner') {
      status(el('tjk-batch-message'),
        (error.message || 'Toplu kayıt doğrulanamadı.') + ' Güncel sonuçları yenileyerek kontrol et.', true);
    }
  } finally {
    resultSaving = false;
    el('result-save').disabled = false;
    el('tjk-csv-file').disabled = false;
    if (currentMember?.role === 'owner') renderOfficialTjkResults();
  }
}

function renderOfficialTjkResults() {
  const list = el('tjk-results-list');
  const message = el('tjk-results-message');
  list.replaceChildren();
  const panel = el('tjk-batch-panel');
  if (!tjkParsedResults || currentMember?.role !== 'owner') {
    hide(panel);
    status(message, '');
    return;
  }
  hide(panel);
  if (raceResultsState !== 'ready') {
    status(message, 'Tahminler ve kayıtlı sonuçlar yüklenmeden eşleştirme kullanılamaz.', true);
    return;
  }
  const shownCsv = tjkParsedResults;
  let known = 0, available = 0;
  for (const row of tjkParsedResults.rows) {
    const item = element('div', 'draft-row');
    const info = element('div');
    info.append(element('div', 'draft-row-title', tjkParsedResults.event_date + ' · '
      + tjkParsedResults.venue + ' · ' + row.race_number + '. koşu'
      + (row.winner === null ? '' : ' · GANYAN(' + row.winner + ')')));
    let description = row.warning || '';
    if (row.winner !== null) {
      known++;
      const matches = allForecasts.filter(record => record.event_date === tjkParsedResults.event_date
        && normalizeForecastVenue(record.venue) === normalizeForecastVenue(tjkParsedResults.venue)
        && Number(record.race_number) === row.race_number);
      if (matches.length !== 1 || !officialRaceResultUrl(matches[0])) {
        description = 'Yayımlanmış tahminle benzersiz eşleşme yok; aktarım engellendi.';
      } else {
        const nameState = publishedPickNameState(matches[0]);
        if (nameState === 'absent') {
          available++;
          description = raceResults.has(matches[0].id)
            ? 'Eski yayında at adları yok; kayıtlı kazanan korunur, yalnız eksik TJK koşu bilgisi eklenebilir.'
            : 'Eski yayında at adları yok; GANYAN kazananı ve TJK koşu bilgisi kaydedilebilir. Ayrıntılı bitiriş sırası oluşturulmaz.';
        } else if (nameState !== 'complete') {
          description = 'Yayımlanmış tahminde at adları kısmi veya geçersiz; kayıt engellendi.';
        } else {
          const details = buildDetailedPickResults(matches[0], row);
          if (!details) description = 'Beş tercihte benzersiz ad eşleşmesi, açık bitiriş/Koşmadı durumu veya GANYAN tutarlılığı sağlanamadı; kayıt engellendi.';
          else {
            available++;
            description = raceResults.has(matches[0].id)
              ? 'Kayıtlı sonuç ayrıntılı CSV verisiyle güncellenebilir; yönetici onayı zorunludur.'
              : 'Beş tercih eşleşti; kaydetmeden önce yönetici onayı zorunludur.';
            const preview = element('ol', 'result-pick-list result-pick-preview');
            for (const detail of details) {
              const pick = matches[0].picks.find(value => Number(value.runner_number) === detail.runner_number);
              const pickItem = element('li');
              pickItem.append(element('span', 'result-pick-name', detail.forecast_rank + '. tercih · '
                + detail.runner_number + (pick?.horse_name_as_published ? ' ' + pick.horse_name_as_published : '')),
              element('strong', detail.status === 'did_not_run' ? 'result-did-not-run' : '',
                detail.status === 'did_not_run' ? 'Koşmadı' : detail.finish_position + '.'));
              preview.append(pickItem);
            }
            info.append(preview);
          }
        }
      }
    }
    const meta = raceMetadata(row.race_metadata);
    if (meta) info.append(element('div', 'draft-row-meta',
      'TJK başlığı: ' + meta.surface + ' · ' + meta.distance_m + ' m · ' + meta.race_type));
    const excluded = tjkExcludedRaces.has(row.race_number);
    if (excluded) description += (description ? ' · ' : '')
      + 'Belirsiz: toplu kayda alınmaz; mevcut sonuç korunur.';
    info.append(element('div', 'draft-row-meta', description));
    const label = element('label', 'tjk-skip-label');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = excluded;
    checkbox.disabled = resultSaving;
    checkbox.setAttribute('aria-label', row.race_number + '. koşu: Belirsiz – Kaydetme');
    checkbox.addEventListener('change', () => {
      if (currentMember?.role !== 'owner' || resultSaving || tjkParsedResults !== shownCsv) return;
      if (checkbox.checked) tjkExcludedRaces.add(row.race_number);
      else tjkExcludedRaces.delete(row.race_number);
      renderOfficialTjkResults();
    });
    label.append(checkbox, element('span', '', 'Belirsiz – Kaydetme'));
    item.classList.toggle('tjk-result-excluded', excluded);
    item.prepend(info);
    item.append(label);
    list.append(item);
  }
  status(message, tjkParsedResults.rows.length + ' koşu bölümü · ' + known
    + ' doğrulanmış sonuç · ' + available + ' eşleşen koşu · '
    + tjkParsedResults.rows.filter(row => tjkExcludedRaces.has(row.race_number)).length
    + ' belirsiz işaretli. Otomatik kayıt yapılmaz. '
    + 'At No bitiriş sırasıdır; kazanan numarası GANYAN’dan alınır. İlk 5 dışındaki kazananı resmî sonuçtan ayrıca doğrula.');
  const plan = prepareTjkBulkBatch();
  show(panel);
  el('tjk-batch-save').disabled = resultSaving || Boolean(plan.error)
    || (plan.remaining === 0 && plan.metadataMissing === 0);
  status(el('tjk-batch-hint'), plan.error || (
    plan.remaining || plan.metadataMissing
      ? plan.entries.length + ' seçili koşu · ' + plan.remaining + ' sonuç/ayrıntı güncellemesi · '
        + plan.metadataMissing + ' TJK koşu başlığı · ' + plan.winnerOnly + ' winner-only kayıt · '
        + plan.skipped + ' belirsiz koşu atlandı. Tek onayla kaydedebilirsin.'
      : plan.entries.length + ' seçili koşunun tüm ayrıntıları ve koşu bilgileri kayıtlı · '
        + plan.skipped + ' belirsiz koşu atlandı.'), Boolean(plan.error));
}
function buildTjkCsvFormatReport(bytes, encoding) {
  const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  if (!decoded.trim()) throw new Error('Dosya boş; incelenecek metin yok.');
  if (decoded.includes('\u0000') || /^\s*<(?:!doctype|html|head|body)\b/i.test(decoded)) {
    throw new Error('Bu dosya metin CSV gibi görünmüyor. TJK sayfasından gerçek CSV dosyasını indir.');
  }
  const allLines = decoded.replace(/\r\n?/g, '\n').split('\n');
  const visibleLines = allLines.map((value, i) => ({ number: i + 1, value }))
    .filter(item => item.value.trim().length > 0);
  const first = visibleLines[0].value;
  const separators = [
    ['noktalı virgül (;)', ';'],
    ['virgül (,)', ','],
    ['sekme (TAB)', '\t'],
  ].map(([name, sign]) => name + ': ' + String(first.split(sign).length - 1));
  const examples = visibleLines.slice(0, 8).map(item => {
    const short = item.value.slice(0, 240).replace(/\t/g, '[TAB]')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
    return item.number + '. satır: ' + short + (item.value.length > 240 ? ' […]' : '');
  });
  return [
    'TJK CSV biçim incelemesi — yalnızca yerel önizleme',
    'Seçilen kodlama: ' + encoding,
    'Boş olmayan metin satırı: ' + visibleLines.length,
    'İlk satırdaki ayraç sayıları (kolon yapısını doğrulamaz): ' + separators.join(' · '),
    'İlk sekiz dolu satır (en fazla 240 karakter):',
    ...examples,
    '',
    'Bu inceleme sonucu, dosyanın TJK kaynağı olduğunu veya kazanan at numarasını doğrulamaz.',
    'Bu rapor sonuç kayıtlarına aktarılmaz; manuel resmî sonuç onayı zorunludur.',
  ].join('\n');
}

async function inspectTjkCsvFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  const selection = ++tjkSelectionSequence;
  tjkParsedResults = null;
  tjkExcludedRaces.clear();
  pendingDetailedResult = null;
  el('result-detail-preview').replaceChildren();
  el('tjk-results-list').replaceChildren();
  hide(el('tjk-batch-panel'));
  status(el('tjk-batch-message'), '');
  status(el('tjk-batch-hint'), '');
  status(el('tjk-results-message'), '');
  const report = el('tjk-csv-report');
  report.value = '';
  hide(report);
  status(el('tjk-csv-inspect-message'), '');
  if (!file || currentMember?.role !== 'owner') return;
  if (!/\.csv$/i.test(file.name) || file.size < 1 || file.size > 262144) {
    status(el('tjk-csv-inspect-message'), '1–262144 bayt arasında bir .csv dosyası seç.', true);
    return;
  }
  const sequence = sessionSequence;
  try {
    const bytes = await file.arrayBuffer();
    if (sequence !== sessionSequence || selection !== tjkSelectionSequence || currentMember?.role !== 'owner') return;
    const encoding = el('tjk-csv-encoding').value;
    const content = buildTjkCsvFormatReport(bytes, encoding);
    report.value = 'Dosya adı: ' + file.name.slice(0, 100) + '\n'
      + 'Boyut: ' + bytes.byteLength + ' bayt\n' + content;
    show(report);
    status(el('tjk-csv-inspect-message'), 'Dosya yalnızca cihazında incelendi; otomatik sonuç kaydı yapılmadı.');
    try {
      const raw = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      tjkParsedResults = parseOfficialTjkResults(raw);
      renderOfficialTjkResults();
    } catch (parseError) {
      status(el('tjk-results-message'), parseError.message || 'TJK sonuç biçimi çözümlenemedi.', true);
    }
  } catch (error) {
    if (sequence !== sessionSequence || selection !== tjkSelectionSequence || currentMember?.role !== 'owner') return;
    status(el('tjk-csv-inspect-message'),
      'Dosya çözümlenemedi. Kodlamayı değiştirip yeniden seç. '
      + (error instanceof TypeError ? 'Seçilen kodlama desteklenmiyor veya dosya bu kodlamada değil.' : (error.message || 'Geçersiz dosya.')),
      true);
  }
}

async function copyTjkCsvReport() {
  if (currentMember?.role !== 'owner') return;
  const report = el('tjk-csv-report');
  if (!report.value) return;
  try {
    await navigator.clipboard.writeText(report.value);
    if (currentMember?.role === 'owner') status(el('tjk-csv-inspect-message'), 'Biçim raporu kopyalandı.');
  } catch {
    report.focus();
    report.select();
    status(el('tjk-csv-inspect-message'), 'Rapor seçildi; telefonun kopyalama menüsünü kullan.');
  }
}


const FORECAST_PAGE_SIZE = 100;

function renderArchiveControls() {
  const panel = el('forecast-archive-controls');
  if (!currentMember || !allForecasts.length) {
    hide(panel);
    hide(el('forecast-load-older'));
    hide(el('history-load-older'));
    status(el('forecast-archive-message'), '');
    return;
  }
  show(panel);
  for (const id of ['forecast-load-older', 'history-load-older']) {
    const button = el(id);
    if (archiveHasMore) show(button);
    else hide(button);
    button.disabled = archiveBusy || raceResultsState !== 'ready';
  }
  status(el('forecast-archive-message'), archiveBusy
    ? 'Daha eski tahminler yükleniyor…'
    : allForecasts.length + ' yayımlanmış tahmin yüklendi'
      + (archiveHasMore ? '. Daha eski kayıtları yükleyebilirsin.' : '. Yüklenebilir eski kayıt kalmadı.'));
}

function fetchForecastPage(offset) {
  return supabase.from('yt_app_publications')
    .select('id,event_date,venue,race_number,title,picks,model_version,evidence_status,note,published_at')
    .order('event_date', { ascending: false })
    .order('race_number', { ascending: true })
    .order('venue', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + FORECAST_PAGE_SIZE - 1);
}

async function loadOlderForecasts() {
  if (!currentMember || archiveBusy || !archiveHasMore || raceResultsState !== 'ready') return;
  const sequence = sessionSequence;
  const request = ++forecastLoadSequence;
  archiveBusy = true;
  renderArchiveControls();
  try {
    const { data, error } = await fetchForecastPage(archiveOffset);
    if (sequence !== sessionSequence || request !== forecastLoadSequence || !currentMember) return;
    if (error) throw error;
    const batch = data || [];
    archiveOffset += batch.length;
    archiveHasMore = batch.length === FORECAST_PAGE_SIZE;
    archiveBusy = false;
    if (!batch.length) {
      renderArchiveControls();
      return;
    }
    const known = new Set(allForecasts.map(record => record.id));
    const additional = batch.filter(record => !known.has(record.id));
    allForecasts.push(...additional);
    populateForecastFilters(forecastsForActiveTab());
    populateRaceSelection();
    el('publication-count').textContent = String(allForecasts.length);
    applyForecastFilters();
    renderArchiveControls();
    if (additional.length) await loadRaceResults(additional.map(record => record.id));
    else renderPerformanceHistory();
  } catch {
    if (sequence !== sessionSequence || request !== forecastLoadSequence || !currentMember) return;
    archiveBusy = false;
    renderArchiveControls();
    status(el('forecast-archive-message'), 'Eski tahminler alınamadı. Tekrar denemek için düğmeye bas.', true);
  }
}


async function loadRaceResults(newIds = null) {
  if (!currentMember) return;
  const sequence = sessionSequence;
  const forecastSequence = forecastLoadSequence;
  const request = ++raceResultsLoadSequence;
  const incremental = Array.isArray(newIds) && raceResultsState === 'ready';
  const loaded = incremental ? new Map(raceResults) : new Map();
  raceResultsState = 'idle';
  applyForecastFilters();
  renderResultCsvPreview();
  renderOfficialTjkResults();
  renderPerformanceHistory();
  renderArchiveControls();
  const ids = incremental ? newIds : allForecasts.map(record => record.id);
  const isCurrent = () => sequence === sessionSequence && forecastSequence === forecastLoadSequence
    && request === raceResultsLoadSequence && Boolean(currentMember);
  try {
    for (let start = 0; start < ids.length; start += FORECAST_PAGE_SIZE) {
      const { data, error } = await supabase.from('yt_app_race_results')
        .select('publication_id,winner_runner_number,pick_results,recorded_at,race_surface,race_distance_m,race_type')
        .in('publication_id', ids.slice(start, start + FORECAST_PAGE_SIZE))
        .limit(FORECAST_PAGE_SIZE);
      if (!isCurrent()) return;
      if (error) throw error;
      for (const result of data || []) loaded.set(result.publication_id, result);
    }
    if (!isCurrent()) return;
    raceResults = loaded;
    raceResultsState = 'ready';
  } catch {
    if (!isCurrent()) return;
    raceResults = new Map();
    raceResultsState = 'error';
  }
  applyForecastFilters();
  renderResultCsvPreview();
  renderOfficialTjkResults();
  renderPerformanceHistory();
  renderArchiveControls();
  if (currentMember.role === 'owner') syncResultEditor();
}

async function saveRaceResult(event) {
  event.preventDefault();
  if (resultSaving || !currentMember || currentMember.role !== 'owner') return;
  const record = allForecasts.find(item => item.id === el('result-publication').value);
  const winner = Number(el('result-winner').value);
  if (!record || !officialRaceResultUrl(record)
      || !Number.isInteger(winner) || winner < 1 || winner > 999
      || !el('result-confirm').checked) {
    status(el('race-result-message'), 'Koşuyu ve kazanan at numarasını seçip resmî sonuç kontrolünü onayla.', true);
    return;
  }
  const details = pendingDetailedResult?.publication_id === record.id ? pendingDetailedResult : null;
  if (details && details.winner_runner_number !== winner) {
    status(el('race-result-message'), 'Kazanan numarası CSV ayrıntılarıyla çelişiyor. Dosyayı yeniden aç.', true);
    return;
  }
  const previous = raceResults.get(record.id);
  const priorDetails = validPickResults(previous?.pick_results);
  const correcting = Boolean(previous && (previous.winner_runner_number !== winner
    || (details && JSON.stringify(priorDetails) !== JSON.stringify(details.pick_results))));
  if (correcting && !window.confirm(
    formatDay(record.event_date) + ' · ' + record.venue + ' · ' + record.race_number
    + '. koşunun kayıtlı sonucunu güncellemek istediğinden emin misin? Önceki değer ve ayrıntılar işlem geçmişinde saklanacak.'
  )) return;
  const sequence = sessionSequence;
  resultSaving = true;
  el('result-save').disabled = true;
  try {
    const response = await publicationAction({
      action: 'save_race_result',
      publication_id: record.id,
      winner_runner_number: winner,
      confirm_official_result: true,
      replace_existing: correcting,
      ...(details ? {
        source_event_date: details.event_date,
        source_venue: details.venue,
        source_race_number: details.race_number,
        pick_results: details.pick_results,
      } : {}),
    });
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    await loadRaceResults();
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    el('result-confirm').checked = false;
    pendingDetailedResult = null;
    renderPendingDetailedResult(record);
    status(el('race-result-message'), raceResultsState === 'ready'
      ? (response.corrected ? 'Sonuç düzeltildi; eski değer geçmişte saklandı.' :
        response.unchanged ? 'Bu kazanan numarası zaten kayıtlı.' : 'Sonuç kaydedildi.')
      : 'Sonuç kaydedildi ancak güncel liste alınamadı. ↻ Sonuçlar ile tekrar yükle.',
      raceResultsState !== 'ready');
  } catch (error) {
    if (sequence === sessionSequence && currentMember?.role === 'owner') {
      status(el('race-result-message'), error.message || 'Sonuç kaydedilemedi.', true);
    }
  } finally {
    resultSaving = false;
    el('result-save').disabled = false;
  }
}

function renderForecasts(records, filtered = false) {
  const root = el('forecast-list');
  root.replaceChildren();
  if (records.length === 0) {
    root.append(element('p', 'status-message', filtered
      ? 'Seçilen filtrelere uygun yayımlanmış tahmin yok.'
      : 'Henüz yayımlanmış bir tahmin bulunmuyor.'));
    return;
  }
  for (const record of records) root.append(createForecastCard(record, true));
}

function applyForecastFilters() {
  const day = el('forecast-date-filter').value;
  const venue = el('forecast-venue-filter').value;
  const race = el('forecast-race-filter').value;
  const tabRecords = forecastsForActiveTab();
  const filtered = tabRecords.filter(record =>
    (!day || record.event_date === day)
    && (!venue || normalizeForecastVenue(record.venue) === venue)
    && (!race || String(record.race_number) === race));
  filtered.sort((a, b) => b.event_date.localeCompare(a.event_date)
    || Number(a.race_number) - Number(b.race_number)
    || a.venue.localeCompare(b.venue, 'tr-TR'));
  const active = Boolean(day || venue || race);
  renderForecasts(filtered, active);
  renderComparisonSummary(filtered);
  status(el('forecast-filter-message'), active
    ? filtered.length + ' / ' + tabRecords.length + ' bu sekmedeki tahmin gösteriliyor.' : '');
  el('reset-forecast-filters').disabled = !active;
}


async function loadForecasts() {
  if (!currentMember) return;
  const sequence = sessionSequence;
  const request = ++forecastLoadSequence;
  ++commentsGeneration;
  commentStates.clear();
  ++raceResultsLoadSequence;
  archiveBusy = true;
  archiveOffset = 0;
  archiveHasMore = false;
  renderArchiveControls();
  status(el('dashboard-message'), 'Tahminler yükleniyor…');
  const { data, error } = await fetchForecastPage(0);
  if (sequence !== sessionSequence || request !== forecastLoadSequence || !currentMember) return;
  archiveBusy = false;
  if (error) {
    allForecasts = [];
    raceResults = new Map();
    raceResultsState = 'error';
    populateForecastFilters([]);
    populateRaceSelection();
    applyForecastFilters();
    renderResultCsvPreview();
    renderOfficialTjkResults();
    renderPerformanceHistory();
    renderArchiveControls();
    el('publication-count').textContent = '0';
    el('latest-day').textContent = '—';
    status(el('dashboard-message'), 'Tahminler alınamadı. Erişiminizi ve bağlantınızı kontrol edin.', true);
    return;
  }
  status(el('dashboard-message'), '');
  const records = data || [];
  allForecasts = records;
  archiveOffset = records.length;
  archiveHasMore = records.length === FORECAST_PAGE_SIZE;
  raceResults = new Map();
  raceResultsState = 'idle';
  populateForecastFilters(forecastsForActiveTab(records));
  populateRaceSelection();
  renderResultCsvPreview();
  renderOfficialTjkResults();
  renderPerformanceHistory();
  el('publication-count').textContent = String(records.length);
  el('latest-day').textContent = records.length ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(records[0].event_date + 'T12:00:00Z')) : '—';
  applyForecastFilters();
  renderArchiveControls();
  await loadRaceResults();
}

async function syncSession() {
  const sequence = ++sessionSequence;
  show(loading); hide(signin); hide(dashboard); hide(appMessage);
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (sequence !== sessionSequence) return;
    if (userError || !userData.user || userData.user.is_anonymous) {
      currentMember = null;
      showSignIn();
      return;
    }
    // Membership is checked by Supabase RLS again for every forecast SELECT.
    const { data: member, error: memberError } = await supabase.from('yt_app_memberships')
      .select('role,active')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (sequence !== sessionSequence) return;
    if (memberError || !member || !member.active) {
      currentMember = null;
      await supabase.auth.signOut({ scope: 'local' });
      if (sequence !== sessionSequence) return;
      showSignIn('Bu hesap için aktif davetli erişimi bulunmuyor. Yöneticiyle iletişime geçin.', true);
      return;
    }
    currentMember = { ...member, user_id: userData.user.id };
    el('account-email').textContent = userData.user.email || '';
    hide(loading); hide(signin); show(dashboard);
    if (member.role === 'owner') {
      show(adminPanel);
      show(el('publication-panel'));
    } else {
      hide(adminPanel);
      hide(el('publication-panel'));
    }
    await loadForecasts();
    if (member.role === 'owner') {
      await loadMembers();
      await loadDrafts();
      await loadManualPublications();
      await loadPublicationHistory();
    }
  } catch {
    if (sequence === sessionSequence) showSignIn('Bağlantı kurulamadı. Lütfen tekrar deneyin.', true);
  }
}
const LOGIN_RETRY_DELAY_MS = 60_000;

function isLoginRateLimit(error) {
  return error?.code === 'over_email_send_rate_limit'
    || error?.code === 'over_request_rate_limit'
    || error?.status === 429;
}

async function sendLoginLink(event) {
  event.preventDefault();
  const button = el('login-submit');
  if (button.disabled) return;
  button.disabled = true;
  let cooldown = false;
  try {
    const email = el('login-email').value.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${CANONICAL_APP_ORIGIN}/` },
    });
    if (error) throw error;
    cooldown = true;
    show(appMessage);
    status(appMessage, 'Hesabınız tanımlıysa giriş bağlantısı e-postanıza gönderildi. Posta kutunuzu kontrol edin.');
  } catch (error) {
    show(appMessage);
    if (isLoginRateLimit(error)) {
      cooldown = true;
      status(appMessage, 'E-posta gönderimi geçici olarak sınırlandı. En az 60 saniye bekleyin; sınır daha uzun sürebilir. Varsa en son gelen giriş bağlantısını kullanın.', true);
    } else {
      status(appMessage, 'Giriş bağlantısı şu anda gönderilemedi. Bir süre sonra yeniden deneyin veya yöneticiyle iletişime geçin.', true);
    }
  } finally {
    if (cooldown) {
      window.setTimeout(() => { button.disabled = false; }, LOGIN_RETRY_DELAY_MS);
    } else {
      button.disabled = false;
    }
  }
}
async function adminAction(body) {
  const { data, error } = await supabase.functions.invoke('yt-admin', { body });
  if (error) throw new Error(data?.error || error.message || 'İşlem başarısız');
  if (data?.error) throw new Error(data.error);
  return data;
}
async function publicationAction(body) {
  const { data, error } = await supabase.functions.invoke('yt-publications', { body });
  if (error) {
    let message = 'Tahmin servisine erişilemiyor. Oturumu ve bağlantıyı kontrol edin.';
    try {
      if (error.context && typeof error.context.json === 'function') {
        const details = await error.context.json();
        if (typeof details?.error === 'string') message = details.error;
      }
    } catch { /* Network and unreadable errors use the generic message. */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function setDraftBusy(busy) {
  draftBusy = busy;
  for (const input of el('draft-form').querySelectorAll('input, button')) input.disabled = busy;
  for (const button of el('draft-list').querySelectorAll('button')) button.disabled = busy;
  for (const button of el('manual-publication-list').querySelectorAll('button')) button.disabled = busy;
  el('publish-draft').disabled = busy || !selectedDraftId || !el('draft-confirm').checked;
}

function resetDraftForm() {
  selectedDraftId = null;
  el('draft-form').reset();
  el('draft-confirm').checked = false;
  el('publish-draft').disabled = true;
  el('draft-preview-card').replaceChildren();
  hide(el('draft-preview'));
}

function fillDraftForm(draft) {
  selectedDraftId = draft.id;
  el('draft-date').value = draft.event_date;
  el('draft-venue').value = draft.venue;
  el('draft-race').value = draft.race_number;
  const picks = Array.isArray(draft.picks) ? [...draft.picks].sort((a, b) => Number(a.rank) - Number(b.rank)) : [];
  for (let i = 1; i <= 5; i++) {
    el('draft-runner-' + i).value = picks[i - 1]?.runner_number ?? '';
    el('draft-name-' + i).value = picks[i - 1]?.horse_name_as_published ?? '';
  }
}

function previewDraft(draft) {
  selectedDraftId = draft.id;
  const root = el('draft-preview-card');
  root.classList.add('draft-preview-card');
  root.replaceChildren(createForecastCard(draft));
  el('draft-confirm').checked = false;
  el('publish-draft').disabled = true;
  show(el('draft-preview'));
}

function renderDraftList(drafts) {
  const root = el('draft-list');
  root.replaceChildren();
  if (!drafts.length) {
    root.append(element('p', 'status-message', 'Henüz kaydedilmiş taslak yok.'));
    return;
  }
  for (const draft of drafts) {
    const row = element('div', 'draft-row');
    const info = element('div');
    info.append(
      element('div', 'draft-row-title', formatDay(draft.event_date) + ' · ' + draft.venue + ' · ' + draft.race_number + '. koşu'),
      element('div', 'draft-row-meta', '5 sıralı tercih · Taslak'),
    );
    const button = element('button', 'subtle-button', 'Aç ve önizle');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (draftBusy || !currentMember || currentMember.role !== 'owner') return;
      fillDraftForm(draft);
      previewDraft(draft);
      status(el('draft-message'), 'Taslak yüklendi. Düzenlersen yayımlamadan önce tekrar kaydet.');
      el('draft-preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    const cancel = element('button', 'subtle-button', 'Taslağı iptal et');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { void cancelDraft(draft); });
    const actions = element('div', 'draft-actions');
    actions.append(button, cancel);
    row.append(info, actions);
    root.append(row);
  }
}

async function loadDrafts() {
  if (!currentMember || currentMember.role !== 'owner') return;
  const sequence = sessionSequence;
  try {
    const result = await publicationAction({ action: 'list_drafts' });
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    renderDraftList(result.drafts || []);
  } catch (error) {
    if (sequence === sessionSequence && currentMember?.role === 'owner') {
      status(el('draft-message'), error.message || 'Taslaklar yüklenemedi.', true);
    }
  }
}

async function cancelDraft(draft) {
  if (draftBusy || !currentMember || currentMember.role !== 'owner') return;
  const description = formatDay(draft.event_date) + ' · ' + draft.venue + ' · ' + draft.race_number + '. koşu';
  if (!window.confirm(description + ' taslağını iptal etmek istediğinden emin misin?\nTaslak listeden kaldırılacak, denetim kaydı korunacak.')) return;
  const sequence = sessionSequence;
  setDraftBusy(true);
  try {
    await publicationAction({ action: 'cancel_draft', id: draft.id });
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    if (selectedDraftId === draft.id) resetDraftForm();
    status(el('draft-message'), 'Taslak iptal edildi. Kayıt denetim geçmişinde saklanır.');
    await loadDrafts();
    await loadPublicationHistory();
  } catch (error) {
    if (sequence === sessionSequence && currentMember?.role === 'owner') {
      status(el('draft-message'), error.message || 'Taslak iptal edilemedi.', true);
    }
  } finally {
    setDraftBusy(false);
  }
}

function renderManualPublicationList(publications) {
  const root = el('manual-publication-list');
  const count = el('manual-publications-count');
  root.replaceChildren();
  count.textContent = publications.length + ' yayın';
  if (!publications.length) {
    root.append(element('p', 'status-message', 'Henüz elle yayımlanmış tahmin yok. Model 2.2 arşivi burada gösterilmez.'));
    return;
  }
  for (const record of publications) {
    const row = element('details', 'draft-row manual-publication-accordion');
    const summary = element('summary', 'manual-publication-summary');
    const summaryInfo = element('span', 'manual-publication-summary-info');
    const numbers = Array.isArray(record.picks)
      ? [...record.picks].sort((a, b) => Number(a.rank) - Number(b.rank)).map(pick => pick.runner_number).join(' · ')
      : '';
    summaryInfo.append(
      element('span', 'draft-row-title', formatDay(record.event_date) + ' · ' + record.venue + ' · ' + record.race_number + '. koşu'),
      element('span', 'draft-row-meta', 'Yayında'),
    );
    summary.append(summaryInfo);

    const body = element('div', 'manual-publication-body');
    body.append(element('div', 'draft-row-meta manual-publication-picks', 'At no: ' + numbers));
    const button = element('button', 'subtle-button', 'Yayından kaldır');
    button.type = 'button';
    button.addEventListener('click', () => { void retractManualPublication(record); });
    body.append(button);

    row.append(summary, body);
    root.append(row);
  }
}

async function loadManualPublications() {
  if (!currentMember || currentMember.role !== 'owner') return;
  const sequence = sessionSequence;
  try {
    const result = await publicationAction({ action: 'list_manual_publications' });
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    renderManualPublicationList(result.publications || []);
    for (const button of el('manual-publication-list').querySelectorAll('button')) button.disabled = draftBusy;
  } catch (error) {
    if (sequence === sessionSequence && currentMember?.role === 'owner') {
      el('manual-publication-list').replaceChildren();
      el('manual-publications-count').textContent = '—';
      status(el('manual-publication-message'), error.message || 'Elle yayımlanan tahminler yüklenemedi.', true);
    }
  }
}

async function retractManualPublication(record) {
  if (draftBusy || !currentMember || currentMember.role !== 'owner') return;
  const description = formatDay(record.event_date) + ' · ' + record.venue + ' · ' + record.race_number + '. koşu';
  if (!window.confirm(description + ' tahminini yayından kaldırmak istediğinden emin misin?\nÜyeler artık göremeyecek; kayıt ve işlem geçmişi korunacak.')) return;
  const sequence = sessionSequence;
  setDraftBusy(true);
  try {
    await publicationAction({ action: 'retract_manual_publication', id: record.id });
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    status(el('manual-publication-message'), 'Tahmin yayından kaldırıldı. Kayıt ve denetim geçmişi korundu.');
    await loadManualPublications();
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    await loadForecasts();
    await loadPublicationHistory();
  } catch (error) {
    if (sequence === sessionSequence && currentMember?.role === 'owner') {
      status(el('manual-publication-message'), error.message || 'Tahmin yayından kaldırılamadı.', true);
    }
  } finally {
    setDraftBusy(false);
  }
}

function formatHistoryTime(timestamp) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  }).format(new Date(timestamp));
}

function renderPublicationHistory(history) {
  const root = el('publication-history-list');
  const count = el('publication-history-count');
  root.replaceChildren();
  const labels = {
    publish: 'Yayımlandı',
    retract: 'Yayından kaldırıldı',
    cancel_draft: 'Taslak iptal edildi',
  };
  const entries = history.filter(entry => labels[entry.action]);
  count.textContent = entries.length + ' işlem';
  if (!entries.length) {
    root.append(element('p', 'status-message', 'Henüz kayıtlı bir yayın işlemi yok.'));
    return;
  }
  for (const entry of entries) {
    const label = labels[entry.action];
    const row = element('div', 'draft-row history-row');
    const info = element('div');
    info.append(
      element('div', 'history-action', label),
      element('div', 'draft-row-title', formatDay(entry.event_date) + ' · ' + entry.venue + ' · ' + entry.race_number + '. koşu'),
    );
    const time = element('time', 'history-time', formatHistoryTime(entry.occurred_at));
    time.dateTime = entry.occurred_at;
    row.append(info, time);
    root.append(row);
  }
}

async function loadPublicationHistory() {
  if (!currentMember || currentMember.role !== 'owner') return;
  const sequence = sessionSequence;
  status(el('publication-history-message'), 'Geçmiş yükleniyor…');
  try {
    const result = await publicationAction({ action: 'list_publication_history' });
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    renderPublicationHistory(result.history || []);
    status(el('publication-history-message'), '');
  } catch (error) {
    if (sequence === sessionSequence && currentMember?.role === 'owner') {
      el('publication-history-list').replaceChildren();
      el('publication-history-count').textContent = '—';
      status(el('publication-history-message'), error.message || 'Yayın geçmişi yüklenemedi.', true);
    }
  }
}

async function saveDraft(event) {
  event.preventDefault();
  if (draftBusy || !currentMember || currentMember.role !== 'owner') return;
  const sequence = sessionSequence;
  const picks = [];
  for (let i = 1; i <= 5; i++) {
    picks.push({
      runner_number: Number(el('draft-runner-' + i).value),
      horse_name_as_published: el('draft-name-' + i).value.trim(),
    });
  }
  const payload = {
    action: 'save_draft',
    event_date: el('draft-date').value,
    venue: el('draft-venue').value.trim(),
    race_number: Number(el('draft-race').value),
    picks,
    ...(selectedDraftId ? { id: selectedDraftId } : {}),
  };
  setDraftBusy(true);
  try {
    const result = await publicationAction(payload);
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    fillDraftForm(result.draft);
    previewDraft(result.draft);
    status(el('draft-message'), 'Taslak kaydedildi. Önizlemeyi kontrol edip onaylayarak yayımlayabilirsin.');
    await loadDrafts();
  } catch (error) {
    if (sequence === sessionSequence && currentMember?.role === 'owner') {
      status(el('draft-message'), error.message || 'Taslak kaydedilemedi.', true);
    }
  } finally {
    setDraftBusy(false);
  }
}

async function publishDraft() {
  if (draftBusy || !currentMember || currentMember.role !== 'owner'
      || !selectedDraftId || !el('draft-confirm').checked) return;
  const sequence = sessionSequence;
  const id = selectedDraftId;
  setDraftBusy(true);
  try {
    await publicationAction({ action: 'publish_draft', id });
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    resetDraftForm();
    status(el('draft-message'), 'Tahmin yayımlandı. Davetli üyeler artık görebilir.');
    await loadDrafts();
    await loadForecasts();
    await loadManualPublications();
    await loadPublicationHistory();
  } catch (error) {
    if (sequence === sessionSequence && currentMember?.role === 'owner') {
      status(el('draft-message'), error.message || 'Tahmin yayımlanamadı.', true);
      el('draft-confirm').checked = false;
    }
  } finally {
    setDraftBusy(false);
  }
}

async function loadMembers() {
  if (!currentMember || currentMember.role !== 'owner') return;
  const sequence = sessionSequence;
  const root = el('member-list');
  status(el('admin-message'), 'Davetliler yükleniyor…');
  try {
    const result = await adminAction({ action: 'list' });
    if (sequence !== sessionSequence || !currentMember || currentMember.role !== 'owner') return;
    root.replaceChildren();
    for (const member of result.members || []) {
      const item = element('div', 'member');
      const info = element('div');
      info.append(element('div', 'member-email', member.email));
      info.append(element('span', 'member-meta', `${member.role === 'owner' ? 'Yönetici' : 'Üye'} · ${member.active ? 'Etkin' : 'Erişim kapalı'}`));
      item.append(info);
      if (member.role === 'viewer') {
        const toggle = element('button', 'subtle-button', member.active ? 'Erişimi kapat' : 'Yeniden aç');
        toggle.type = 'button';
        toggle.addEventListener('click', async () => {
          toggle.disabled = true;
          try {
            await adminAction({ action: 'set_access', user_id: member.user_id, active: !member.active });
            status(el('admin-message'), 'Üyenin erişimi güncellendi.');
            await loadMembers();
          } catch (error) {
            status(el('admin-message'), error.message || 'Erişim güncellenemedi.', true);
          } finally { toggle.disabled = false; }
        });
        item.append(toggle);
      }
      root.append(item);
    }
    if (!(result.members || []).length) root.append(element('p', 'status-message', 'Henüz davetli bulunmuyor.'));
    status(el('admin-message'), '');
  } catch (error) {
    if (sequence !== sessionSequence || !currentMember) return;
    status(el('admin-message'), 'Yönetim servisine erişilemiyor. Sunucu ve uygulama adresi ayarlarını kontrol edin.', true);
  }
}
async function sendInvite(event) {
  event.preventDefault();
  const button = el('invite-submit');
  button.disabled = true;
  try {
    await adminAction({ action: 'invite', email: el('invite-email').value.trim() });
    el('invite-email').value = '';
    status(el('admin-message'), 'Davet oluşturuldu. Kullanıcının posta kutusunu kontrol edin.');
    await loadMembers();
  } catch (error) {
    status(el('admin-message'), error.message || 'Davet gönderilemedi.', true);
  } finally { button.disabled = false; }
}

el('draft-form').addEventListener('submit', saveDraft);
el('draft-form').addEventListener('input', () => {
  if (!el('draft-preview').classList.contains('hidden')) {
    hide(el('draft-preview'));
    el('draft-confirm').checked = false;
    el('publish-draft').disabled = true;
    status(el('draft-message'), 'Form değişti. Önizlemeden önce taslağı yeniden kaydet.');
  }
});
el('new-draft').addEventListener('click', () => {
  if (draftBusy) return;
  resetDraftForm();
  status(el('draft-message'), '');
});
el('draft-confirm').addEventListener('change', () => {
  el('publish-draft').disabled = draftBusy || !selectedDraftId || !el('draft-confirm').checked;
});
el('publish-draft').addEventListener('click', publishDraft);
el('reload-drafts').addEventListener('click', loadDrafts);
el('reload-manual-publications').addEventListener('click', loadManualPublications);
el('reload-publication-history').addEventListener('click', loadPublicationHistory);
el('reload-race-results').addEventListener('click', loadRaceResults);
el('result-publication').addEventListener('change', syncResultEditor);
el('race-result-form').addEventListener('submit', saveRaceResult);
el('result-csv-file').addEventListener('change', previewResultCsvFile);
el('tjk-csv-file').addEventListener('change', inspectTjkCsvFile);
el('tjk-batch-save').addEventListener('click', saveAllTjkResults);
el('tjk-csv-copy').addEventListener('click', copyTjkCsvReport);
el('login-form').addEventListener('submit', sendLoginLink);
el('invite-form').addEventListener('submit', sendInvite);
el('reload-members').addEventListener('click', loadMembers);
el('refresh-button').addEventListener('click', loadForecasts);
el('current-forecasts-tab').addEventListener('click', () => selectForecastTab('current'));
el('previous-forecasts-tab').addEventListener('click', () => selectForecastTab('previous'));
el('forecast-load-older').addEventListener('click', loadOlderForecasts);
el('history-load-older').addEventListener('click', loadOlderForecasts);
el('forecast-date-filter').addEventListener('change', applyForecastFilters);
el('history-date-filter').addEventListener('change', renderPerformanceHistory);
el('forecast-venue-filter').addEventListener('change', applyForecastFilters);
el('forecast-race-filter').addEventListener('change', applyForecastFilters);
el('reset-forecast-filters').addEventListener('click', () => {
  el('forecast-date-filter').value = '';
  el('forecast-venue-filter').value = '';
  el('forecast-race-filter').value = '';
  applyForecastFilters();
});
el('logout-button').addEventListener('click', async () => {
  await supabase.auth.signOut({ scope: 'local' });
  ++sessionSequence;
  currentMember = null;
  showSignIn('Oturumunuz kapatıldı.');
});
supabase.auth.onAuthStateChange(() => {
  // Run database calls outside the auth callback to avoid refresh deadlocks.
  setTimeout(() => { void syncSession(); }, 0);
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
el('install-button').addEventListener('click', async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
  } else {
    show(appMessage);
    status(appMessage, 'Android Chrome: menü → Ana ekrana ekle. iPhone Safari: Paylaş → Ana Ekrana Ekle.');
  }
});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' })
    .then((registration) => registration.update())
    .catch(() => {});
}
void syncSession();
