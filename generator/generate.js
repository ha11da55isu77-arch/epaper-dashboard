import puppeteer from 'puppeteer';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 地域コード: 140000=神奈川, 130000=東京, 200000=長野 など
const WEATHER_AREA = '200000';
const AREA_NAME = '南部';  // 長野県の場合: 北部/中部/南部
const TEMP_STATION = '飯田';  // 気温観測地点

// ===== 気象庁から天気取得 =====
async function fetchWeather() {
  const defaultResult = {
    target_label: '今日',
    target_date: new Date(),
    today_weather: '情報取得中',
    today_code: '100',
    tempMin: null,
    tempMax: null,
    pops: [],
    popTimes: [],
    updated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  };
  
  try {
    const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${WEATHER_AREA}.json`;
    const res = await fetch(url);
    
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      console.warn('Weather API returned non-JSON, using defaults');
      return defaultResult;
    }
    
    const data = await res.json();
    const result = { ...defaultResult };
    
    // 今の時刻を日本時間で取得
    const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const currentHour = jstNow.getHours();
    
    // 17時以降は「明日」の予報を見る
    const useTomorrow = currentHour >= 17;
    result.target_label = useTomorrow ? '明日' : '今日';
    
    const findArea = (areas) => {
      return areas.find(a => a.area.name.includes(AREA_NAME)) || areas[0];
    };
    
    // 天気文字列（timeDefines[0]=今日, [1]=明日）
    const weatherSeries = data[0].timeSeries[0];
    const weatherArea = findArea(weatherSeries.areas);
    const weatherIdx = useTomorrow && weatherArea.weathers.length > 1 ? 1 : 0;
    result.today_weather = weatherArea.weathers[weatherIdx];
    result.today_code = weatherArea.weatherCodes[weatherIdx];
    
    // target_date を計算（ターゲット日付）
    const targetDate = new Date(jstNow);
    if (useTomorrow) targetDate.setDate(targetDate.getDate() + 1);
    result.target_date = targetDate;
    
    // 降水確率: 対象日のpopsだけを抽出
    const popSeries = data[0].timeSeries[1];
    if (popSeries) {
      const popArea = findArea(popSeries.areas);
      const targetYmd = `${targetDate.getFullYear()}${String(targetDate.getMonth()+1).padStart(2,'0')}${String(targetDate.getDate()).padStart(2,'0')}`;
      
      const pops = [];
      const popTimes = [];
      for (let i = 0; i < popSeries.timeDefines.length; i++) {
        const t = new Date(popSeries.timeDefines[i]);
        const ymd = `${t.getFullYear()}${String(t.getMonth()+1).padStart(2,'0')}${String(t.getDate()).padStart(2,'0')}`;
        if (ymd === targetYmd) {
          pops.push(popArea.pops[i]);
          popTimes.push(popSeries.timeDefines[i]);
        }
      }
      result.pops = pops;
      result.popTimes = popTimes;
    }
    
    // 気温
    const tempMinSeries = data[0].timeSeries.find(t => t.areas[0].tempsMin);
    if (tempMinSeries) {
      const area = tempMinSeries.areas.find(a => a.area.name.includes(TEMP_STATION)) || tempMinSeries.areas[0];
      const idx = useTomorrow && area.tempsMin.length > 1 ? 1 : 0;
      const v = Number(area.tempsMin[idx]);
      if (!isNaN(v) && v !== 0) result.tempMin = v;
    }
    const tempMaxSeries = data[0].timeSeries.find(t => t.areas[0].tempsMax);
    if (tempMaxSeries) {
      const area = tempMaxSeries.areas.find(a => a.area.name.includes(TEMP_STATION)) || tempMaxSeries.areas[0];
      const idx = useTomorrow && area.tempsMax.length > 1 ? 1 : 0;
      const v = Number(area.tempsMax[idx]);
      if (!isNaN(v) && v !== 0) result.tempMax = v;
    }
    
    // 週間予報も見る（明日以降の気温）
    if (useTomorrow && (!result.tempMin || !result.tempMax)) {
      const weeklyTemp = data[1]?.timeSeries?.find(t => t.areas[0].tempsMin || t.areas[0].tempsMax);
      if (weeklyTemp) {
        const weeklyArea = weeklyTemp.areas[0];
        // 週間予報は[今日,明日,明後日...]の順。明日=index 1
        if (weeklyArea.tempsMin && !result.tempMin) {
          const v = Number(weeklyArea.tempsMin[1]);
          if (!isNaN(v)) result.tempMin = v;
        }
        if (weeklyArea.tempsMax && !result.tempMax) {
          const v = Number(weeklyArea.tempsMax[1]);
          if (!isNaN(v)) result.tempMax = v;
        }
      }
    }
    
    return result;
  } catch (e) {
    console.error('Weather fetch failed:', e.message);
    return defaultResult;
  }
}

async function fetchGasData() {
  const url = `${process.env.GAS_URL}?action=getDisplayData`;
  const res = await fetch(url);
  return res.json();
}

function getWeatherIcon(code) {
  const c = String(code);
  if (c.startsWith('1')) return '☀️';
  if (c.startsWith('2')) return '☁️';
  if (c.startsWith('3')) return '🌧️';
  if (c.startsWith('4')) return '❄️';
  return '🌤️';
}

function parseWeatherIcons(weatherText) {
  // 時間帯・条件キーワードで分割
  const separators = /のち|時々|一時|所により|夜遅く|朝のうち|昼過ぎ|夜|朝|昼|夕方|未明|明け方|\s+/;
  const parts = weatherText.split(separators);
  
  const icons = [];
  const seen = new Set();
  
  for (const p of parts) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    
    let icon = null;
    if (trimmed.includes('雪')) icon = '❄️';
    else if (trimmed.includes('雨')) icon = '🌧️';
    else if (trimmed.includes('くもり') || trimmed.includes('曇')) icon = '☁️';
    else if (trimmed.includes('晴')) icon = '☀️';
    
    // 重複を除外（既に同じアイコンがあれば追加しない）
    if (icon && !seen.has(icon)) {
      icons.push(icon);
      seen.add(icon);
    }
  }
  
  if (icons.length === 0) icons.push('🌤️');
  return icons.slice(0, 3);
}

function formatHour(isoString) {
  const d = new Date(isoString);
  const h = d.getHours();
  return `${h}時`;
}

// ===== 1. 天気のみ =====
function renderWeatherOnlyHTML(weather) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}年 ${today.getMonth()+1}月 ${today.getDate()}日 (${['日','月','火','水','木','金','土'][today.getDay()]})`;
  const icons = parseWeatherIcons(weather.today_weather);
  const iconsHtml = icons.map((icon, i) => {
    const arrow = i < icons.length - 1 ? '<span style="font-size:60px;color:#F5A623;margin:0 10px;">→</span>' : '';
    return `<span>${icon}</span>${arrow}`;
  }).join('');
  
  const tempStr = (weather.tempMax !== null || weather.tempMin !== null) 
    ? `最低 ${weather.tempMin ?? '-'}° &nbsp;/&nbsp; 最高 ${weather.tempMax ?? '-'}°`
    : '';

  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        width: 800px; height: 480px; 
        font-family: 'Noto Sans JP', sans-serif;
        background: white; color: #222;
        display: flex; flex-direction: column;
        align-items: center; padding: 30px;
      }
      .date { font-size: 28px; color: #666; }
      .icons { font-size: 160px; line-height: 1; margin: 20px 0; display: flex; align-items: center; }
      .weather { font-size: 40px; font-weight: 700; }
      .temps { font-size: 28px; color: #666; margin-top: 16px; }
    </style></head><body>
      <div class="date">${dateStr}</div>
      <div class="icons">${iconsHtml}</div>
      <div class="weather">${weather.today_weather}</div>
      <div class="temps">${tempStr}</div>
    </body></html>
  `;
}

// ===== 2. 天気＋日にち =====
function renderWeatherCalendarHTML(weather, events, settings) {
  const today = new Date();
  const targetYmd = `${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,'0')}-${String(targetDate.getDate()).padStart(2,'0')}`;
  
  const todayEvents = events.filter(e => e.date === targetYmd);
  const eventsHtml = todayEvents.length 
    ? todayEvents.map(e => {
        const color = e.person === settings.person1_name ? settings.person1_color :
                      e.person === settings.person2_name ? settings.person2_color : '#999';
        return `<div class="event"><span class="dot" style="background:${color}"></span>${e.title}<span class="person">${e.person}</span></div>`;
      }).join('')
    : '<div class="no-event">今日の予定はありません</div>';
  
  const icons = parseWeatherIcons(weather.today_weather);
  const iconsHtml = icons.map((icon, i) => {
    const arrow = i < icons.length - 1 ? '<span class="arrow">→</span>' : '';
    return `<span class="icon">${icon}</span>${arrow}`;
  }).join('');
  
  const popLabels = ['0-6', '6-12', '12-18', '18-24'];
  const pops = weather.pops.length >= 4 ? weather.pops.slice(0, 4) : [null, null, null, null];
  
  const popCells = popLabels.map((label, i) => 
    `<div class="pop-cell"><div class="pop-label">${label}</div><div class="pop-val">${pops[i] ?? '-'}%</div></div>`
  ).join('');
  
  const weekdayName = ['日','月','火','水','木','金','土'][today.getDay()];
  const targetDate = weather.target_date || today;
  const targetWeekday = ['日','月','火','水','木','金','土'][targetDate.getDay()];
  const headerText = `${weather.target_label || '今日'} ${targetDate.getDate()}日(${targetWeekday})`;

  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        width: 800px; height: 480px; 
        font-family: 'Noto Sans JP', sans-serif;
        background: white; color: #222;
        display: flex;
      }
      .left {
        width: 420px; padding: 16px 20px;
        border-right: 2px solid #eee;
        display: flex; flex-direction: column;
      }
      .header-bar {
        background: #4A90E2; color: white;
        padding: 8px 14px; border-radius: 6px;
        font-size: 20px; font-weight: 700;
        text-align: center;
      }
      .icons-row {
        display: flex; align-items: center; justify-content: center;
        margin: 12px 0; gap: 8px;
      }
      .icon { font-size: 80px; line-height: 1; }
      .arrow { font-size: 36px; color: #F5A623; font-weight: bold; }
      .weather-text { 
        font-size: 26px; text-align: center; font-weight: 600;
        border-top: 1px solid #ddd; border-bottom: 1px solid #ddd;
        padding: 8px 0;
      }
      .pop-table {
        display: grid; grid-template-columns: repeat(4, 1fr);
        margin-top: 10px;
      }
      .pop-cell {
        text-align: center; padding: 6px 4px;
        border-right: 1px solid #eee;
      }
      .pop-cell:last-child { border-right: none; }
      .pop-label { font-size: 14px; color: #666; }
      .pop-val { font-size: 22px; font-weight: 700; color: #4A90E2; margin-top: 2px; }
      .temp-row {
        display: grid; grid-template-columns: 1fr 1fr;
        border-top: 2px solid #ddd; margin-top: 8px; padding-top: 8px;
      }
      .temp-cell { text-align: center; }
      .temp-label { font-size: 14px; color: #666; }
      .temp-val { font-size: 36px; font-weight: 700; margin-top: 2px; }
      .temp-cell.min .temp-val { color: #4A90E2; }
      .temp-cell.max .temp-val { color: #E24A4A; }
      
      .right { 
        width: 380px; padding: 30px; 
        display: flex; flex-direction: column; 
      }
      .date-big { 
        font-size: 120px; font-weight: 900; line-height: 1;
        color: #E24A8B;
      }
      .date-sub { font-size: 22px; color: #666; margin-top: 8px; }
      .weekday { font-size: 28px; color: #4A90E2; margin-top: 8px; font-weight: 600; }
      .events-title { 
        font-size: 18px; color: #999; margin-top: 26px; 
        border-bottom: 2px solid #eee; padding-bottom: 6px;
      }
      .events { margin-top: 10px; }
      .event { 
        font-size: 18px; padding: 8px 0;
        display: flex; align-items: center;
        border-bottom: 1px solid #f5f5f5;
      }
      .dot { 
        display: inline-block; width: 12px; height: 12px; 
        border-radius: 50%; margin-right: 12px;
      }
      .person { 
        font-size: 13px; color: #999; margin-left: auto;
      }
      .no-event { color: #ccc; font-size: 16px; padding: 16px 0; }
    </style></head><body>
      <div class="left">
        <div class="header-bar">${headerText}</div>
        <div class="icons-row">${iconsHtml}</div>
        <div class="weather-text">${weather.today_weather}</div>
        <div class="pop-table">${popCells}</div>
        <div class="temp-row">
          <div class="temp-cell min">
            <div class="temp-label">朝の最低</div>
            <div class="temp-val">${weather.tempMin ?? '-'}°</div>
          </div>
          <div class="temp-cell max">
            <div class="temp-label">日中の最高</div>
            <div class="temp-val">${weather.tempMax ?? '-'}°</div>
          </div>
        </div>
      </div>
      <div class="right">
        <div class="date-big">${targetDate.getDate()}</div>
        <div class="date-sub">${targetDate.getFullYear()}年 ${targetDate.getMonth() + 1}月</div>
        <div class="weekday">${targetWeekday}曜日</div>
        <div class="events-title">${weather.target_label || '今日'}の予定</div>
        <div class="events">${eventsHtml}</div>
      </div>
    </body></html>
  `;
}

// ===== 3. 月カレンダー =====
function renderMonthCalendarHTML(events, settings) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  const eventsByDate = {};
  events.forEach(e => {
    if (e.date.startsWith(`${year}-${String(month+1).padStart(2,'0')}`)) {
      const d = parseInt(e.date.split('-')[2]);
      if (!eventsByDate[d]) eventsByDate[d] = [];
      eventsByDate[d].push(e);
    }
  });
  
  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<div class="cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate();
    const dayEvents = eventsByDate[d] || [];
    
    const eventsText = dayEvents.slice(0, 2).map(e => {
      const color = e.person === settings.person1_name ? settings.person1_color :
                    e.person === settings.person2_name ? settings.person2_color : '#999';
      const shortTitle = e.title.length > 10 ? e.title.substring(0, 10) + '…' : e.title;
      return `<div class="event-text" style="color:${color}">${shortTitle}</div>`;
    }).join('');
    
    const moreCount = dayEvents.length > 2 ? `<div class="more">+${dayEvents.length - 2}</div>` : '';
    
    cells += `
      <div class="cell ${isToday ? 'today' : ''}">
        <div class="day">${d}</div>
        ${eventsText}
        ${moreCount}
      </div>`;
  }
  
  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        width: 800px; height: 480px; 
        font-family: 'Noto Sans JP', sans-serif;
        padding: 16px 24px; background: white;
      }
      .header { display: flex; align-items: baseline; margin-bottom: 6px; }
      .month { font-size: 48px; font-weight: 900; color: #4A90E2; }
      .year { font-size: 20px; color: #999; margin-left: 12px; }
      .legend { margin-left: auto; font-size: 13px; color: #666; }
      .legend-item { display: inline-flex; align-items: center; margin-left: 12px; }
      .legend-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
      .weekdays, .grid { display: grid; grid-template-columns: repeat(7, 1fr); }
      .weekdays { font-size: 13px; color: #999; text-align: center; padding: 4px 0; border-bottom: 1px solid #eee; }
      .weekdays div:first-child { color: #E24A8B; }
      .weekdays div:last-child { color: #4A90E2; }
      .cell { 
        border-right: 1px solid #f5f5f5; border-bottom: 1px solid #f5f5f5;
        padding: 4px 6px; height: 62px; position: relative;
        overflow: hidden;
      }
      .cell.empty { background: #fafafa; }
      .day { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
      .cell.today .day { 
        background: #E24A8B; color: white; 
        width: 22px; height: 22px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px;
      }
      .event-text {
        font-size: 10px; line-height: 1.3;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font-weight: 500;
      }
      .more { font-size: 9px; color: #bbb; margin-top: 1px; }
    </style></head><body>
      <div class="header">
        <div class="month">${month + 1}</div>
        <div class="year">${year}年</div>
        <div class="legend">
          <span class="legend-item"><span class="legend-dot" style="background:${settings.person1_color}"></span>${settings.person1_name}</span>
          <span class="legend-item"><span class="legend-dot" style="background:${settings.person2_color}"></span>${settings.person2_name}</span>
        </div>
      </div>
      <div class="weekdays"><div>日</div><div>月</div><div>火</div><div>水</div><div>木</div><div>金</div><div>土</div></div>
      <div class="grid">${cells}</div>
    </body></html>
  `;
}

// ===== 4. 写真 =====
function renderPhotoHTML(imageUrl) {
  if (!imageUrl) {
    return `
      <!DOCTYPE html><html><body style="width:800px;height:480px;margin:0;display:flex;align-items:center;justify-content:center;font-family:'Noto Sans JP',sans-serif;font-size:24px;color:#999;">
      画像が選択されていません
      </body></html>`;
  }
  return `
    <!DOCTYPE html><html><head><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        width: 800px; height: 480px; background: #000;
        display: flex; align-items: center; justify-content: center;
        overflow: hidden;
      }
      img { max-width: 800px; max-height: 480px; object-fit: contain; }
    </style></head><body>
      <img src="${imageUrl}" alt="">
    </body></html>`;
}

async function main() {
  console.log('Fetching data...');
  const gasData = await fetchGasData();
  
  if (gasData.error) {
    console.error('GAS error:', gasData.error);
    process.exit(1);
  }
  
  const weather = await fetchWeather();
  console.log('Weather:', JSON.stringify(weather));
  
  const { settings, events } = gasData;
  console.log(`Image URL exists: ${gasData.imageUrl ? 'YES' : 'NO'}`);
  
  let mode = settings.mode || 'auto';
  
  if (mode === 'auto') {
    const hour = new Date().toLocaleString('ja-JP', { 
      timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false
    });
    mode = parseInt(hour) < 12 ? 'weather_calendar' : 'month_calendar';
    console.log(`Auto mode → ${mode}`);
  }
  
  console.log(`Mode: ${mode}`);
  
  let html;
  switch (mode) {
    case 'weather_only':
      html = renderWeatherOnlyHTML(weather); break;
    case 'weather_calendar':
      html = renderWeatherCalendarHTML(weather, events, settings); break;
    case 'month_calendar':
      html = renderMonthCalendarHTML(events, settings); break;
    case 'photo':
      html = renderPhotoHTML(gasData.imageUrl); break;
    default:
      html = renderWeatherCalendarHTML(weather, events, settings);
  }
  
  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 480, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  await page.screenshot({
    path: path.join(outDir, 'display.png'),
    fullPage: false,
    clip: { x: 0, y: 0, width: 800, height: 480 }
  });
  
  await browser.close();
  console.log('Done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
