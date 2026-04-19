import puppeteer from 'puppeteer';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 地域コード: 140000=神奈川, 130000=東京, 270000=大阪 など
const WEATHER_AREA = '2038500';

// ===== 気象庁から天気・気温・降水確率を取得 =====
async function fetchWeather() {
  const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${WEATHER_AREA}.json`;
  const res = await fetch(url);
  const data = await res.json();
  
  const result = {
    today_weather: '',
    today_code: '100',
    tempMin: null,
    tempMax: null,
    pops: [],       // 降水確率 6時間ごと
    popTimes: [],   // 降水確率の時間ラベル
    updated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  };
  
  try {
    // 今日の天気
    result.today_weather = data[0].timeSeries[0].areas[0].weathers[0];
    result.today_code = data[0].timeSeries[0].areas[0].weatherCodes[0];
    
    // 降水確率（6時間ごと）
    const popSeries = data[0].timeSeries[1];
    if (popSeries) {
      result.pops = popSeries.areas[0].pops.slice(0, 4);
      result.popTimes = popSeries.timeDefines.slice(0, 4);
    }
    
    // 気温（最低・最高）- data[1]は週間予報
    const weeklyTemp = data[1]?.timeSeries?.find(t => t.areas[0].tempsMin || t.areas[0].temps);
    if (weeklyTemp) {
      const temps = weeklyTemp.areas[0].temps;
      if (temps && temps.length >= 2) {
        result.tempMin = Number(temps[0]);
        result.tempMax = Number(temps[1]);
      }
    }
    
    // data[0]のtemp系列も試す
    const dailyTempMin = data[0].timeSeries.find(t => t.areas[0].tempsMin);
    if (dailyTempMin) {
      const v = Number(dailyTempMin.areas[0].tempsMin[0]);
      if (!isNaN(v)) result.tempMin = v;
    }
    const dailyTempMax = data[0].timeSeries.find(t => t.areas[0].tempsMax);
    if (dailyTempMax) {
      const v = Number(dailyTempMax.areas[0].tempsMax[0]);
      if (!isNaN(v)) result.tempMax = v;
    }
  } catch (e) {
    console.error('Weather parse error:', e);
  }
  
  return result;
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

// 時刻ラベルを "6時" のような形式に
function formatHour(isoString) {
  const d = new Date(isoString);
  const h = d.getHours();
  return `${h}時`;
}

// ===== 1. 天気のみ =====
function renderWeatherOnlyHTML(weather) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}年 ${today.getMonth()+1}月 ${today.getDate()}日 (${['日','月','火','水','木','金','土'][today.getDay()]})`;
  const icon = getWeatherIcon(weather.today_code);
  
  const tempStr = (weather.tempMax !== null || weather.tempMin !== null) 
    ? `最低 ${weather.tempMin ?? '-'}° &nbsp;/&nbsp; 最高 ${weather.tempMax ?? '-'}°`
    : '';
  
  // 降水確率の棒グラフ
  const popBars = weather.pops.map((p, i) => `
    <div class="pop-item">
      <div class="pop-time">${formatHour(weather.popTimes[i])}</div>
      <div class="pop-bar-wrap"><div class="pop-bar" style="height:${p || 0}%"></div></div>
      <div class="pop-value">${p ?? '-'}%</div>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        width: 800px; height: 480px; 
        font-family: 'Noto Sans JP', sans-serif;
        background: white; color: #222;
        display: flex; flex-direction: column;
        align-items: center; padding: 20px;
      }
      .date { font-size: 24px; color: #666; }
      .main { display: flex; align-items: center; margin-top: 10px; gap: 30px; }
      .icon { font-size: 180px; line-height: 1; }
      .info { display: flex; flex-direction: column; }
      .weather { font-size: 44px; font-weight: 700; }
      .temps { font-size: 28px; color: #666; margin-top: 10px; }
      .pop-section { 
        display: flex; gap: 24px; margin-top: 24px;
        padding: 16px 32px; border-top: 1px solid #eee; width: 100%;
        justify-content: center; align-items: flex-end;
      }
      .pop-item { text-align: center; }
      .pop-time { font-size: 14px; color: #999; }
      .pop-bar-wrap {
        width: 40px; height: 50px; background: #f0f0f0;
        border-radius: 6px; position: relative; margin: 4px auto;
        display: flex; align-items: flex-end;
      }
      .pop-bar { 
        width: 100%; background: #4A90E2; 
        border-radius: 6px; min-height: 2px;
      }
      .pop-value { font-size: 14px; font-weight: 600; color: #4A90E2; }
    </style></head><body>
      <div class="date">${dateStr}</div>
      <div class="main">
        <div class="icon">${icon}</div>
        <div class="info">
          <div class="weather">${weather.today_weather}</div>
          <div class="temps">${tempStr}</div>
        </div>
      </div>
      <div class="pop-section">
        ${popBars || '<div style="color:#ccc">降水確率情報なし</div>'}
      </div>
    </body></html>
  `;
}

// ===== 2. 天気＋日にち =====
function renderWeatherCalendarHTML(weather, events, settings) {
  const today = new Date();
  const ymd = today.toISOString().split('T')[0];
  
  const todayEvents = events.filter(e => e.date === ymd);
  const eventsHtml = todayEvents.length 
    ? todayEvents.map(e => {
        const color = e.person === settings.person1_name ? settings.person1_color :
                      e.person === settings.person2_name ? settings.person2_color : '#999';
        return `<div class="event"><span class="dot" style="background:${color}"></span>${e.title}<span class="person">${e.person}</span></div>`;
      }).join('')
    : '<div class="no-event">今日の予定はありません</div>';
  
  const icon = getWeatherIcon(weather.today_code);
  const tempStr = (weather.tempMax !== null || weather.tempMin !== null) 
    ? `${weather.tempMin ?? '-'}° / ${weather.tempMax ?? '-'}°`
    : '';
  
  // 降水確率を時間別気温の代わりに表示
  const pops = weather.pops.slice(0, 3);
  const popTimes = weather.popTimes.slice(0, 3);
  const hourlyBlocks = pops.map((p, i) => `
    <div class="hourly-item">
      <div class="hourly-time">${formatHour(popTimes[i])}</div>
      <div class="hourly-icon">💧</div>
      <div class="hourly-temp">${p ?? '-'}%</div>
    </div>
  `).join('') || '<div style="color:#ccc">降水情報なし</div>';

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
        width: 400px; padding: 30px;
        border-right: 2px solid #eee;
        display: flex; flex-direction: column;
      }
      .weather-icon { font-size: 120px; text-align: center; line-height: 1; }
      .weather-text { font-size: 30px; text-align: center; margin-top: 8px; font-weight: 600; }
      .temps { font-size: 26px; text-align: center; color: #666; margin-top: 6px; }
      .hourly-label { 
        font-size: 13px; color: #999; text-align: center; 
        margin-top: 20px; border-top: 1px solid #eee; padding-top: 14px;
      }
      .hourly { 
        display: flex; justify-content: space-around; margin-top: 8px;
      }
      .hourly-item { text-align: center; }
      .hourly-time { font-size: 16px; color: #666; }
      .hourly-icon { font-size: 32px; margin: 4px 0; }
      .hourly-temp { font-size: 20px; font-weight: 600; color: #4A90E2; }
      
      .right { width: 400px; padding: 30px; display: flex; flex-direction: column; }
      .date-big { 
        font-size: 120px; font-weight: 900; line-height: 1;
        color: #E24A8B;
      }
      .date-sub { font-size: 22px; color: #666; margin-top: 8px; }
      .weekday { font-size: 28px; color: #4A90E2; margin-top: 8px; font-weight: 600; }
      .events-title { 
        font-size: 18px; color: #999; margin-top: 30px; 
        border-bottom: 2px solid #eee; padding-bottom: 6px;
      }
      .events { margin-top: 12px; }
      .event { 
        font-size: 20px; padding: 10px 0;
        display: flex; align-items: center;
        border-bottom: 1px solid #f5f5f5;
      }
      .dot { 
        display: inline-block; width: 12px; height: 12px; 
        border-radius: 50%; margin-right: 12px;
      }
      .person { 
        font-size: 14px; color: #999; margin-left: auto;
      }
      .no-event { color: #ccc; font-size: 18px; padding: 20px 0; }
    </style></head><body>
      <div class="left">
        <div class="weather-icon">${icon}</div>
        <div class="weather-text">${weather.today_weather}</div>
        <div class="temps">${tempStr}</div>
        <div class="hourly-label">降水確率</div>
        <div class="hourly">${hourlyBlocks}</div>
      </div>
      <div class="right">
        <div class="date-big">${today.getDate()}</div>
        <div class="date-sub">${today.getFullYear()}年 ${today.getMonth() + 1}月</div>
        <div class="weekday">${['日','月','火','水','木','金','土'][today.getDay()]}曜日</div>
        <div class="events-title">今日の予定</div>
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
  console.log(`Image URL exists: ${gasData.imageUrl ? 'YES (' + gasData.imageUrl.length + ' chars)' : 'NO'}`);
  
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
