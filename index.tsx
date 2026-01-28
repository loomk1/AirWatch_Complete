import { GoogleGenAI } from "@google/genai";

declare const Chart: any;
declare const L: any;

const OPENWEATHER_API_KEY = "bf57504e06985889868020dc567d8730";

const DEFAULT_CITIES = [
    "London", "Paris", "Berlin", "Madrid", "Rome", "Amsterdam", "New York", "San Francisco", "Los Angeles", "Chicago", "Tokyo", "Seoul", "Singapore", "Sydney", "Mumbai", "Delhi", "Dubai"
];

interface ForecastDay {
    dayName: string;
    temp: number;
    icon: string;
    description: string;
}

interface CityData {
  id: number;
  name: string;
  country: string;
  temp: number;
  humidity: number;
  aqi: number;
  lat: number;
  lon: number;
  windSpeed: number;
  windDeg: number;
  lastUpdated: Date;
  forecast: ForecastDay[];
}

let cityData: Record<string, CityData> = {};
let selectedCities = new Set<string>();
let currentView: 'grid' | 'map' = 'grid';
let mapInstance: any = null;
let mapMarkers: any[] = [];
let isDarkMode = true;
let currentlyViewingHistoryCity: CityData | null = null;
let recentSearches: string[] = JSON.parse(localStorage.getItem('recent_searches') || '[]');

// DOM Elements
const cardsContainer = document.getElementById('cards')!;
const mapViewContainer = document.getElementById('map-view')!;
const loader = document.getElementById('loader')!;
const addModal = document.getElementById('addModal')!;
const compareModal = document.getElementById('compareModal')!;
const cityHistoryModal = document.getElementById('cityHistoryModal')!;
const cityInput = document.getElementById('cityInput') as HTMLInputElement;
const aiResultDiv = document.getElementById('ai-result')!;
const aiLoadingDiv = document.getElementById('ai-loading')!;
const aiContentBody = document.getElementById('ai-content-body')!;
const recentSearchesContainer = document.getElementById('recentSearches')!;
const recentList = document.getElementById('recentList')!;

const viewGridBtn = document.getElementById('view-grid-btn')!;
const viewMapBtn = document.getElementById('view-map-btn')!;
const themeToggleBtn = document.getElementById('theme-toggle')!;

// New Controls
const fullscreenBtn = document.getElementById('fullscreen-btn')!;
const hardReloadBtn = document.getElementById('hard-reload-btn')!;

// Chart Instances
let aqiChartInstance: any = null;
let tempChartInstance: any = null;
let humChartInstance: any = null;
let windChartInstance: any = null;
let radarChartInstance: any = null;
let historyChartInstance: any = null;
let cityHistoryChartInstance: any = null;

// --- Helper Functions ---

async function safeFetch(url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Fetch failed for URL: ${url}`, error);
        throw error;
    }
}

(window as any).toggleSelection = (cityName: string, isChecked: boolean) => {
  if (isChecked) selectedCities.add(cityName);
  else selectedCities.delete(cityName);
  updateCompareButton();
};

(window as any).refreshCity = async (name: string) => {
    const data = await fetchCityData(name);
    if(data) {
        cityData[name] = data;
        render();
        if (currentView === 'map') updateMapMarkers();
    }
};

(window as any).removeCity = (name: string) => {
    if(confirm(`Remove ${name} from your list?`)) {
        delete cityData[name];
        selectedCities.delete(name);
        render();
        if (currentView === 'map') updateMapMarkers();
    }
};

(window as any).viewHistory = (name: string) => {
    const data = cityData[name];
    if (data) openCityHistory(data);
};

(window as any).selectRecent = (name: string) => {
    cityInput.value = name;
    recentSearchesContainer.classList.add('hidden');
    handleAddCity();
};

function getWindDir(deg: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(deg / 45) % 8;
  return directions[index];
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') setTheme(false);
    else setTheme(true);
}

function setTheme(dark: boolean) {
    isDarkMode = dark;
    const html = document.documentElement;
    const darkIcon = document.getElementById('theme-icon-dark')!;
    const lightIcon = document.getElementById('theme-icon-light')!;

    if (dark) {
        html.classList.add('dark');
        darkIcon.classList.remove('hidden');
        lightIcon.classList.add('hidden');
        localStorage.setItem('theme', 'dark');
    } else {
        html.classList.remove('dark');
        darkIcon.classList.add('hidden');
        lightIcon.classList.remove('hidden');
        localStorage.setItem('theme', 'light');
    }

    render();
    if (!compareModal.classList.contains('hidden')) {
        const activeTab = document.querySelector('[aria-selected="true"][id^="tab-btn-"]')?.id.replace('tab-btn-', '') as any;
        if (activeTab === 'charts') buildCompareCharts();
        if (activeTab === 'history') buildHistoryChart();
        if (activeTab === 'table') buildCompareTable();
    }
    if (!cityHistoryModal.classList.contains('hidden') && currentlyViewingHistoryCity) {
        openCityHistory(currentlyViewingHistoryCity);
    }
}

async function init() {
  initTheme();
  try {
      if (loader) loader.classList.remove('hidden');
      setupEventListeners();
      const results = await Promise.all(
          DEFAULT_CITIES.map(c => fetchCityData(c).catch(() => null))
      );
      results.forEach(res => { if(res) cityData[res.name] = res; });
      render();
  } catch (error) {
      console.error("Initialization failed:", error);
  } finally {
      if (loader) loader.classList.add('hidden');
  }
}

function setupEventListeners() {
  themeToggleBtn?.addEventListener('click', () => setTheme(!isDarkMode));
  
  // App Level Controls
  fullscreenBtn?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
  });

  hardReloadBtn?.addEventListener('click', () => {
    if(confirm("Hard reload the application? Unsaved data will be lost.")) {
        window.location.reload();
    }
  });

  document.getElementById('compareBtn')?.addEventListener('click', openCompareModal);
  document.getElementById('addCityBtn')?.addEventListener('click', openAddModal);
  document.getElementById('cancelAddBtn')?.addEventListener('click', closeAddModal);
  document.getElementById('confirmAddBtn')?.addEventListener('click', handleAddCity);
  document.getElementById('closeCompareModalBtn')?.addEventListener('click', closeCompareModal);
  document.getElementById('closeCityHistoryModalBtn')?.addEventListener('click', closeCityHistoryModal);
  viewGridBtn?.addEventListener('click', () => switchView('grid'));
  viewMapBtn?.addEventListener('click', () => switchView('map'));
  document.getElementById('tab-btn-table')?.addEventListener('click', () => switchCompareTab('table'));
  document.getElementById('tab-btn-charts')?.addEventListener('click', () => switchCompareTab('charts'));
  document.getElementById('tab-btn-history')?.addEventListener('click', () => switchCompareTab('history'));
  document.getElementById('tab-btn-insights')?.addEventListener('click', () => switchCompareTab('insights'));
  cityInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter') handleAddCity(); });
  cityInput?.addEventListener('focus', () => renderRecentSearches());
  document.addEventListener('mousedown', (e) => {
      if (!cityInput.contains(e.target as Node) && !recentSearchesContainer.contains(e.target as Node)) {
          recentSearchesContainer.classList.add('hidden');
      }
  });
}

function getAqiInfo(aqi: number) {
  if (aqi <= 50) return { label: 'Good', advisory: 'Air is ideal for outdoor activities.', color: isDarkMode ? 'text-green-400' : 'text-emerald-700', pill: isDarkMode ? 'bg-green-900/40 text-green-300 border-green-800' : 'bg-emerald-100 text-emerald-800 border-emerald-200', hex: '#10b981', bg: isDarkMode ? 'bg-gradient-to-br from-gray-800 to-green-900/20' : 'bg-white', border: isDarkMode ? 'border-green-500' : 'border-emerald-500', barGradient: 'bg-gradient-to-r from-emerald-400 to-emerald-600' };
  if (aqi <= 100) return { label: 'Moderate', advisory: 'Sensitive groups should limit exertion.', color: isDarkMode ? 'text-yellow-400' : 'text-amber-800', pill: isDarkMode ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800' : 'bg-amber-100 text-amber-900 border-amber-200', hex: '#f59e0b', bg: isDarkMode ? 'bg-gradient-to-br from-gray-800 to-yellow-900/20' : 'bg-white', border: isDarkMode ? 'border-yellow-500' : 'border-amber-500', barGradient: 'bg-gradient-to-r from-yellow-400 to-amber-500' };
  if (aqi <= 150) return { label: 'Sensitive', advisory: 'Reduce intense outdoor exercise.', color: isDarkMode ? 'text-orange-400' : 'text-orange-800', pill: isDarkMode ? 'bg-orange-900/40 text-orange-300 border-orange-800' : 'bg-orange-100 text-orange-900 border-orange-200', hex: '#f97316', bg: isDarkMode ? 'bg-gradient-to-br from-gray-800 to-orange-900/20' : 'bg-white', border: isDarkMode ? 'border-orange-500' : 'border-orange-500', barGradient: 'bg-gradient-to-r from-orange-400 to-orange-600' };
  if (aqi <= 200) return { label: 'Unhealthy', advisory: 'Limit prolonged outdoor exertion.', color: isDarkMode ? 'text-red-400' : 'text-red-700', pill: isDarkMode ? 'bg-red-900/40 text-red-300 border-red-800' : 'bg-red-100 text-red-800 border-red-200', hex: '#ef4444', bg: isDarkMode ? 'bg-gradient-to-br from-gray-800 to-red-900/20' : 'bg-white', border: isDarkMode ? 'border-red-500' : 'border-red-500', barGradient: 'bg-gradient-to-r from-red-500 to-red-600' };
  if (aqi <= 300) return { label: 'Very Unhealthy', advisory: 'Avoid outdoor activities; stay indoors.', color: isDarkMode ? 'text-purple-400' : 'text-purple-700', pill: isDarkMode ? 'bg-purple-900/40 text-purple-300 border-purple-800' : 'bg-purple-100 text-purple-800 border-purple-200', hex: '#a855f7', bg: isDarkMode ? 'bg-gradient-to-br from-gray-800 to-purple-900/20' : 'bg-white', border: isDarkMode ? 'border-purple-500' : 'border-purple-500', barGradient: 'bg-gradient-to-r from-purple-500 to-purple-600' };
  return { label: 'Hazardous', advisory: 'Health alert: Everyone stay indoors.', color: isDarkMode ? 'text-rose-400' : 'text-rose-700', pill: isDarkMode ? 'bg-rose-900/40 text-rose-300 border-rose-800' : 'bg-rose-100 text-rose-800 border-rose-200', hex: '#e11d48', bg: isDarkMode ? 'bg-gradient-to-br from-gray-800 to-rose-900/20' : 'bg-white', border: isDarkMode ? 'border-rose-600' : 'border-rose-600', barGradient: 'bg-gradient-to-r from-rose-500 to-rose-700' };
}

function pm25ToAQI(pm25: number) {
  const c = pm25;
  if (c < 12.1) return linear(50, 0, 12.0, 0, c);
  if (c < 35.5) return linear(100, 51, 35.4, 12.1, c);
  if (c < 55.5) return linear(150, 101, 55.4, 35.5, c);
  if (c < 150.5) return linear(200, 151, 150.4, 55.5, c);
  if (c < 250.5) return linear(300, 201, 250.4, 150.5, c);
  if (c < 350.5) return linear(400, 301, 350.4, 250.5, c);
  return linear(500, 401, 500.4, 350.5, c);
}

function linear(Ih: number, Il: number, Ch: number, Cl: number, C: number) {
  if (Ch === Cl) return Il;
  return Math.round(((Ih - Il) / (Ch - Cl)) * (C - Cl) + Il);
}

function processForecast(list: any[]): ForecastDay[] {
    if (!Array.isArray(list)) return [];
    const dailyForecasts: ForecastDay[] = [];
    const seenDays = new Set<string>();
    for (const item of list) {
        if (dailyForecasts.length >= 3) break;
        const date = new Date(item.dt * 1000);
        const dayKey = date.toLocaleDateString();
        const hour = date.getHours();
        if (!seenDays.has(dayKey)) {
            if (hour >= 11 && hour <= 14) {
                 seenDays.add(dayKey);
                 dailyForecasts.push({ 
                    dayName: date.toLocaleDateString('en-US', { weekday: 'short' }), 
                    temp: Math.round(item.main.temp), 
                    icon: item.weather[0].icon, 
                    description: item.weather[0].main 
                });
            }
        }
    }
    return dailyForecasts;
}

async function fetchCityData(cityName: string): Promise<CityData | null> {
  try {
      const weather = await safeFetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cityName)}&units=metric&appid=${OPENWEATHER_API_KEY}`);
      const [air, forecastData] = await Promise.all([
          safeFetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${weather.coord.lat}&lon=${weather.coord.lon}&appid=${OPENWEATHER_API_KEY}`),
          safeFetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${weather.coord.lat}&lon=${weather.coord.lon}&units=metric&appid=${OPENWEATHER_API_KEY}`)
      ]);
      const pm25 = air?.list?.[0]?.components?.pm2_5 ?? 10;
      const aqi = pm25ToAQI(pm25);
      return { 
          id: weather.id, name: weather.name, country: weather.sys.country, temp: Math.round(weather.main.temp), humidity: weather.main.humidity, aqi, 
          lat: weather.coord.lat, lon: weather.coord.lon, windSpeed: weather.wind.speed, windDeg: weather.wind.deg, lastUpdated: new Date(), 
          forecast: processForecast(forecastData?.list || []) 
      };
  } catch (error) { 
      console.warn(`Data retrieval failed for ${cityName}.`);
      return null; 
  }
}

function switchView(view: 'grid' | 'map') {
    currentView = view;
    const isGrid = view === 'grid';
    viewGridBtn.classList.toggle('bg-white', isGrid);
    viewGridBtn.classList.toggle('dark:bg-gray-600', isGrid);
    viewGridBtn.classList.toggle('shadow-sm', isGrid);
    viewGridBtn.classList.toggle('text-indigo-600', isGrid);
    viewGridBtn.setAttribute('aria-selected', isGrid.toString());
    viewMapBtn.classList.toggle('bg-white', !isGrid);
    viewMapBtn.classList.toggle('dark:bg-gray-600', !isGrid);
    viewMapBtn.classList.toggle('shadow-sm', !isGrid);
    viewMapBtn.classList.toggle('text-indigo-600', !isGrid);
    viewMapBtn.setAttribute('aria-selected', (!isGrid).toString());
    cardsContainer.classList.toggle('hidden', !isGrid);
    mapViewContainer.classList.toggle('hidden', isGrid);
    if (!isGrid) setTimeout(() => initMap(), 50);
}

function initMap() {
    if (typeof L === 'undefined' || !document.getElementById('map')) return;
    if (!mapInstance) {
        mapInstance = L.map('map', { zoomControl: false, attributionControl: false }).setView([20, 0], 2); 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInstance);
        L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);
    }
    setTimeout(() => {
        mapInstance.invalidateSize();
        updateMapMarkers();
    }, 100);
}

function updateMapMarkers() {
    if (!mapInstance) return;
    mapMarkers.forEach(m => mapInstance.removeLayer(m));
    mapMarkers = [];
    Object.values(cityData).forEach(city => {
        const info = getAqiInfo(city.aqi);
        const pulseHtml = city.aqi > 100 ? `<div class="aqi-marker-pulse" style="background-color: ${info.hex}"></div>` : '';
        const statusLabel = info.label.split(' ')[0];
        
        const icon = L.divIcon({
            className: 'custom-map-marker',
            html: `
              <div class="aqi-marker-container">
                ${pulseHtml}
                <div class="relative w-10 h-10 rounded-full border-2 border-white flex flex-col items-center justify-center text-white shadow-xl transform transition-all duration-300 hover:scale-125 hover:z-50" style="background-color: ${info.hex}; cursor: pointer;">
                    <span class="text-[11px] font-black leading-none">${city.aqi}</span>
                    <span class="text-[6px] uppercase font-bold tracking-tighter mt-0.5 opacity-90">${statusLabel}</span>
                </div>
                <div class="w-2 h-2 absolute -bottom-1 left-1/2 -translate-x-1/2 rotate-45" style="background-color: ${info.hex}; border-right: 2px solid white; border-bottom: 2px solid white;"></div>
              </div>
            `,
            iconSize: [40, 45],
            iconAnchor: [20, 45]
        });

        const marker = L.marker([city.lat, city.lon], { icon }).addTo(mapInstance);
        marker.bindPopup(`<div class="font-sans min-w-[160px] p-1"><h3 class="font-bold text-lg mb-1">${city.name}</h3><span class="text-xs font-bold px-2 py-0.5 rounded-full ${info.pill}">${info.label} (AQI: ${city.aqi})</span></div>`);
        mapMarkers.push(marker);
    });
}

function updateCompareButton() {
  const countSpan = document.getElementById('compareCount')!;
  countSpan.innerText = selectedCities.size.toString();
  countSpan.classList.toggle('hidden', selectedCities.size === 0);
}

function render() {
  if (!cardsContainer) return;
  cardsContainer.innerHTML = '';
  const cities = Object.keys(cityData);
  if(cities.length === 0) {
      cardsContainer.innerHTML = `<div class="col-span-full text-center py-20 text-gray-500 font-medium">No cities added. Track a city to start.</div>`;
  } else {
      cities.forEach(city => {
          const data = cityData[city];
          if(data) cardsContainer.innerHTML += createCardHTML(data);
      });
  }
  updateCompareButton();
}

function createCardHTML(data: CityData) {
  const aqiInfo = getAqiInfo(data.aqi);
  const isSelected = selectedCities.has(data.name);
  const windLabel = getWindDir(data.windDeg);
  const forecastHTML = data.forecast.length > 0 ? `
      <div class="px-5 sm:px-6 pb-5 sm:pb-6 pt-2 border-t border-gray-100 dark:border-gray-700/50 mt-1">
        <h4 class="text-[9px] font-bold tracking-widest text-gray-400 dark:text-gray-500 uppercase mb-3 pt-3">3-Day Forecast</h4>
        <div class="grid grid-cols-3 gap-2 sm:gap-3">
          ${data.forecast.map(day => `
             <div class="flex flex-col items-center p-2 sm:p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/30">
                <span class="text-[9px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-tighter mb-1">${day.dayName}</span>
                <img src="https://openweathermap.org/img/wn/${day.icon}@2x.png" alt="${day.description}" class="w-8 h-8 sm:w-10 sm:h-10">
                <span class="text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-200">${day.temp}°</span>
             </div>`).join('')}
        </div>
      </div>` : '';

  return `
  <section aria-labelledby="city-${data.id}" class="relative ${aqiInfo.bg} rounded-3xl shadow-card dark:shadow-card-dark hover:shadow-card-hover dark:hover:shadow-card-hover-dark transition-all duration-300 overflow-hidden group border border-gray-200 dark:border-gray-700/60">
      <div class="absolute top-0 left-0 w-full h-1.5 ${aqiInfo.barGradient}" aria-hidden="true"></div>
      <div class="px-5 sm:px-6 pt-5 sm:pt-6 pb-2 flex justify-between items-start relative z-10">
          <div class="flex items-center gap-1.5 text-gray-400 dark:text-gray-500 font-bold text-[9px] uppercase tracking-widest">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span>${data.country}</span>
          </div>
          <div class="flex items-center gap-1.5">
              <button onclick="window.viewHistory('${data.name}')" class="p-2 text-gray-400 hover:text-indigo-600 transition-colors" aria-label="View history"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg></button>
              <button onclick="window.refreshCity('${data.name}')" class="p-2 text-gray-300 dark:text-gray-500 hover:text-indigo-600 transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button>
              <button onclick="window.removeCity('${data.name}')" class="p-2 text-gray-300 dark:text-gray-500 hover:text-red-500 transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
              <label class="flex items-center cursor-pointer p-2 -mr-1">
                <input type="checkbox" onchange="window.toggleSelection('${data.name}', this.checked)" ${isSelected ? 'checked' : ''} class="w-5 h-5 rounded border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-indigo-600 focus:ring-indigo-500">
              </label>
          </div>
      </div>
      <div class="px-5 sm:px-6 mb-4 sm:mb-6 relative z-10">
        <h2 id="city-${data.id}" class="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight leading-tight group-hover:text-indigo-600 transition-colors">${data.name}</h2>
      </div>
      <div class="px-5 sm:px-6 pb-4 sm:pb-2 flex flex-col sm:flex-row gap-6 relative z-10">
          <div class="flex sm:flex-col items-center justify-between sm:justify-center gap-4">
              <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-[5px] sm:border-[6px] ${aqiInfo.border} bg-gray-50 dark:bg-gray-800/80 backdrop-blur-sm flex items-center justify-center relative shadow-inner"><span class="text-2xl sm:text-3xl font-black text-gray-800 dark:text-gray-100">${data.aqi}</span></div>
              <div class="flex flex-col items-center sm:items-center text-right sm:text-center">
                  <div class="mt-0 sm:mt-2 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border ${aqiInfo.pill}">${aqiInfo.label}</div>
                  <p class="mt-2 text-[10px] leading-tight font-medium text-gray-500 dark:text-gray-400 max-w-[120px] italic hidden sm:block">"${aqiInfo.advisory}"</p>
              </div>
          </div>
          <div class="flex-1 grid grid-cols-2 sm:flex sm:flex-col gap-2.5 sm:gap-3 justify-center">
              <div class="flex items-center gap-2.5 p-2.5 bg-gray-50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-100 dark:border-gray-700/50">
                  <div class="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 shadow-sm flex items-center justify-center text-orange-500 shrink-0"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg></div>
                  <div class="flex flex-col"><span class="text-[9px] text-gray-400 dark:text-gray-600 font-bold uppercase tracking-tighter leading-none mb-1">Temp</span><span class="text-base font-bold text-gray-900 dark:text-gray-100 leading-none">${data.temp}°C</span></div>
              </div>
              <div class="flex items-center gap-2.5 p-2.5 bg-gray-50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-100 dark:border-gray-700/50">
                  <div class="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 shadow-sm flex items-center justify-center text-sky-500 shrink-0"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 24 24"><path d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg></div>
                  <div class="flex flex-col"><span class="text-[9px] text-gray-400 dark:text-gray-600 font-bold uppercase tracking-tighter leading-none mb-1">Humidity</span><span class="text-base font-bold text-gray-900 dark:text-gray-100 leading-none">${data.humidity}%</span></div>
              </div>
              <div class="col-span-2 flex items-center gap-2.5 p-2.5 bg-gray-50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-100 dark:border-gray-700/50">
                  <div class="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 shadow-sm flex items-center justify-center text-teal-500 shrink-0"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" /></svg></div>
                  <div class="flex flex-col"><span class="text-[9px] text-gray-400 dark:text-gray-600 font-bold uppercase tracking-tighter leading-none mb-1">Wind</span><div class="flex items-center gap-2"><span class="text-base font-bold text-gray-900 dark:text-gray-100 leading-none">${data.windSpeed}<span class="text-xs ml-0.5 font-normal opacity-70">m/s</span></span><div class="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-lg border border-indigo-100/50 dark:border-indigo-700/30"><svg class="w-3 h-3 text-indigo-500" style="transform: rotate(${data.windDeg}deg)" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg><span class="text-[9px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-tighter">${windLabel}</span></div></div></div>
              </div>
          </div>
      </div>
      ${forecastHTML}
  </section>`;
}

function openAddModal() { 
    addModal.classList.remove('hidden', 'opacity-0'); 
    setTimeout(() => { addModal.querySelector('div')!.classList.replace('scale-95', 'scale-100'); cityInput.focus(); }, 10); 
}

function closeAddModal() { 
    addModal.querySelector('div')!.classList.replace('scale-100', 'scale-95'); 
    addModal.classList.add('opacity-0'); 
    setTimeout(() => { addModal.classList.add('hidden'); cityInput.value = ''; }, 200); 
}

function renderRecentSearches() {
    if (recentSearches.length === 0) { recentSearchesContainer.classList.add('hidden'); return; }
    recentList.innerHTML = '';
    recentSearches.forEach(name => {
        const item = document.createElement('button');
        item.className = "px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors dark:text-gray-300 font-medium";
        item.innerText = name;
        item.setAttribute('role', 'option');
        item.onclick = () => (window as any).selectRecent(name);
        recentList.appendChild(item);
    });
    recentSearchesContainer.classList.remove('hidden');
}

async function handleAddCity() { 
    const city = cityInput.value.trim(); 
    if(!city) return; 
    const data = await fetchCityData(city); 
    if(data) { 
        cityData[data.name] = data; 
        recentSearches = [data.name, ...recentSearches.filter(n => n !== data.name)].slice(0, 5);
        localStorage.setItem('recent_searches', JSON.stringify(recentSearches));
        render(); closeAddModal(); 
        if (currentView === 'map') updateMapMarkers(); 
    } else { alert(`City "${city}" not found.`); } 
}

function openCompareModal() {
  if (selectedCities.size < 2) { alert('Select at least 2 cities.'); return; }
  buildCompareSummary(); buildCompareTable(); buildCompareCharts();
  switchCompareTab('table');
  compareModal.classList.remove('hidden', 'opacity-0');
  setTimeout(() => compareModal.querySelector('div')!.classList.replace('scale-95', 'scale-100'), 10);
}

function closeCompareModal() { compareModal.querySelector('div')!.classList.replace('scale-100', 'scale-95'); compareModal.classList.add('opacity-0'); setTimeout(() => compareModal.classList.add('hidden'), 200); }

function switchCompareTab(tab: 'table' | 'charts' | 'history' | 'insights') {
    ['table', 'charts', 'history', 'insights'].forEach(t => {
        const view = document.getElementById(`compare-view-${t}`);
        if(view) view.classList.toggle('hidden', t !== tab);
        const btn = document.getElementById(`tab-btn-${t}`);
        if(btn) {
            btn.classList.toggle('bg-white', t === tab);
            btn.classList.toggle('dark:bg-gray-600', t === tab);
            btn.classList.toggle('shadow-sm', t === tab);
            btn.classList.toggle('text-indigo-600', t === tab);
            btn.setAttribute('aria-selected', (t === tab).toString());
        }
    });
    if (tab === 'insights') generateAIInsights();
    else if (tab === 'history') buildHistoryChart();
    else if (tab === 'charts') buildCompareCharts();
}

function buildCompareSummary() {
    const summaryContainer = document.getElementById('compareHighlights')!;
    const cities = Array.from(selectedCities).map(name => cityData[name]).filter(Boolean);
    const bestAQI = [...cities].sort((a,b) => a.aqi - b.aqi)[0];
    const coolest = [...cities].sort((a,b) => a.temp - b.temp)[0];
    const windiest = [...cities].sort((a,b) => b.windSpeed - a.windSpeed)[0];
    
    summaryContainer.innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div class="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-800/30">
                <span class="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest block mb-1">Cleanest Air</span>
                <span class="text-base sm:text-lg font-black block truncate">${bestAQI.name}</span>
                <span class="text-[10px] block text-emerald-600/70">AQI: ${bestAQI.aqi}</span>
            </div>
            <div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border border-blue-100 dark:border-blue-800/30">
                <span class="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest block mb-1">Coolest City</span>
                <span class="text-base sm:text-lg font-black block truncate">${coolest.name}</span>
                <span class="text-[10px] block text-blue-600/70">Temp: ${coolest.temp}°C</span>
            </div>
            <div class="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800/30">
                <span class="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest block mb-1">High Wind</span>
                <span class="text-base sm:text-lg font-black block truncate">${windiest.name}</span>
                <span class="text-[10px] block text-indigo-600/70">${windiest.windSpeed} m/s</span>
            </div>
        </div>`;
}

function buildCompareTable() {
    const tbody = document.getElementById('compareTableBody')!;
    tbody.innerHTML = '';
    selectedCities.forEach(city => {
        const d = cityData[city]; if(!d) return;
        const info = getAqiInfo(d.aqi);
        tbody.innerHTML += `<tr class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"><td class="px-4 sm:px-8 py-4 whitespace-nowrap text-sm font-bold">${d.name}</td><td class="px-4 sm:px-8 py-4 whitespace-nowrap"><span class="px-3 py-1 rounded-full text-[10px] font-black ${info.pill}">${d.aqi}</span></td><td class="px-4 sm:px-8 py-4 whitespace-nowrap text-sm font-bold">${d.temp}°C</td><td class="px-4 sm:px-8 py-4 whitespace-nowrap text-sm font-bold">${d.humidity}%</td><td class="px-4 sm:px-8 py-4 whitespace-nowrap"><span class="${info.color} text-xs font-black uppercase tracking-tight">${info.label}</span></td></tr>`;
    });
}

function buildCompareCharts() {
    const cities = Array.from(selectedCities).map(name => cityData[name]).filter(Boolean);
    const labels = cities.map(c => c.name);
    const textColor = isDarkMode ? '#9ca3af' : '#1f2937';
    const gridColor = isDarkMode ? '#374151' : '#e5e7eb';
    
    const baseOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } }, y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } }, beginAtZero: true } } };

    if (aqiChartInstance) aqiChartInstance.destroy();
    aqiChartInstance = new Chart(document.getElementById('aqiChart'), { type: 'bar', data: { labels, datasets: [{ data: cities.map(c => c.aqi), backgroundColor: cities.map(c => getAqiInfo(c.aqi).hex), borderRadius: 6 }] }, options: baseOpts });

    if (tempChartInstance) tempChartInstance.destroy();
    tempChartInstance = new Chart(document.getElementById('tempChart'), { type: 'bar', data: { labels, datasets: [{ data: cities.map(c => c.temp), backgroundColor: '#f97316', borderRadius: 6 }] }, options: baseOpts });

    if (radarChartInstance) radarChartInstance.destroy();
    const radarColors = ['rgba(99, 102, 241, 0.4)', 'rgba(236, 72, 153, 0.4)', 'rgba(16, 185, 129, 0.4)'];
    const radarBorders = ['#6366f1', '#ec4899', '#10b981'];
    
    radarChartInstance = new Chart(document.getElementById('radarChart'), {
        type: 'radar',
        data: {
            labels: ['AQI (norm)', 'Temp (x2)', 'Humidity', 'Wind (x10)'],
            datasets: cities.map((c, i) => ({ label: c.name, data: [c.aqi / 2, c.temp * 2, c.humidity, c.windSpeed * 10], backgroundColor: radarColors[i % 3], borderColor: radarBorders[i % 3], pointBackgroundColor: radarBorders[i % 3], borderWidth: 2 }))
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { r: { grid: { color: gridColor }, angleLines: { color: gridColor }, pointLabels: { color: textColor, font: { weight: 'bold', size: 9 } }, ticks: { display: false } } }, plugins: { legend: { display: true, position: 'bottom', labels: { color: textColor, usePointStyle: true, boxWidth: 6, font: { size: 10 } } } } }
    });
}

async function buildHistoryChart() {
    const loading = document.getElementById('history-loading')!;
    loading.classList.remove('hidden');
    if (historyChartInstance) historyChartInstance.destroy();
    const datasets: any[] = [];
    const labels: string[] = [];
    const now = new Date();
    for(let i=6; i>=0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); labels.push(d.toLocaleDateString('en-US', { weekday: 'short' })); }
    const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6'];
    let idx = 0;
    for (const name of selectedCities) {
        const city = cityData[name]; if(!city) continue;
        const start = Math.floor(Date.now()/1000) - 604800;
        try {
            const data = await safeFetch(`https://api.openweathermap.org/data/2.5/air_pollution/history?lat=${city.lat}&lon=${city.lon}&start=${start}&end=${Math.floor(Date.now()/1000)}&appid=${OPENWEATHER_API_KEY}`);
            const dailyMap = new Map();
            data.list.forEach((it: any) => { const k = new Date(it.dt * 1000).toDateString(); if(!dailyMap.has(k)) dailyMap.set(k, {sum: 0, count: 0}); dailyMap.get(k).sum += pm25ToAQI(it.components.pm2_5); dailyMap.get(k).count++; });
            datasets.push({ label: name, data: Array.from(dailyMap.values()).map(v => Math.round(v.sum/v.count)).slice(-7), borderColor: colors[idx++ % 5], tension: 0.3, fill: false, borderWidth: 2 });
        } catch (e) {}
    }
    historyChartInstance = new Chart(document.getElementById('historyChart'), { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 6, font: { size: 10 } } } } } });
    loading.classList.add('hidden');
}

async function openCityHistory(data: CityData) {
    currentlyViewingHistoryCity = data;
    (document.getElementById('historyModalTitle') as HTMLElement).innerText = `${data.name} Trends`;
    document.getElementById('city-history-loading')!.classList.remove('hidden');
    cityHistoryModal.classList.remove('hidden', 'opacity-0');
    setTimeout(() => cityHistoryModal.querySelector('div')!.classList.replace('scale-95', 'scale-100'), 10);
    const startUnix = Math.floor(Date.now() / 1000) - (30 * 86400);
    try {
        const hData = await safeFetch(`https://api.openweathermap.org/data/2.5/air_pollution/history?lat=${data.lat}&lon=${data.lon}&start=${startUnix}&end=${Math.floor(Date.now()/1000)}&appid=${OPENWEATHER_API_KEY}`);
        renderCityHistoryChart(hData.list);
    } catch (e) {}
    document.getElementById('city-history-loading')!.classList.add('hidden');
}

function closeCityHistoryModal() { cityHistoryModal.querySelector('div')!.classList.replace('scale-100', 'scale-95'); cityHistoryModal.classList.add('opacity-0'); setTimeout(() => cityHistoryModal.classList.add('hidden'), 200); }

function renderCityHistoryChart(rawData: any[]) {
    if (cityHistoryChartInstance) cityHistoryChartInstance.destroy();
    const daily = new Map<string, { sum: number, count: number, date: Date }>();
    rawData.forEach(it => { const d = new Date(it.dt * 1000); const k = d.toDateString(); if (!daily.has(k)) daily.set(k, { sum: 0, count: 0, date: d }); daily.get(k)!.sum += pm25ToAQI(it.components.pm2_5); daily.get(k)!.count++; });
    const sorted = Array.from(daily.keys()).sort((a,b) => daily.get(a)!.date.getTime() - daily.get(b)!.date.getTime());
    cityHistoryChartInstance = new Chart(document.getElementById('cityHistoryChart'), { type: 'line', data: { labels: sorted.map(k => daily.get(k)!.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })), datasets: [{ label: 'Daily Avg AQI', data: sorted.map(k => Math.round(daily.get(k)!.sum/daily.get(k)!.count)), borderColor: '#6366f1', tension: 0.3, fill: true, backgroundColor: 'rgba(99, 102, 241, 0.1)' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
}

async function generateAIInsights() {
    aiLoadingDiv.classList.remove('hidden'); aiResultDiv.classList.add('hidden');
    const stats = await Promise.all(Array.from(selectedCities).map(async (name) => {
        const city = cityData[name]; if(!city) return null;
        try {
            const start = Math.floor(Date.now() / 1000) - (30 * 86400);
            const data = await safeFetch(`https://api.openweathermap.org/data/2.5/air_pollution/history?lat=${city.lat}&lon=${city.lon}&start=${start}&end=${Math.floor(Date.now()/1000)}&appid=${OPENWEATHER_API_KEY}`);
            const aqis = data.list.map((it: any) => pm25ToAQI(it.components.pm2_5));
            return { name, current: city.aqi, avg: Math.round(aqis.reduce((a:number,b:number)=>a+b,0)/aqis.length), peak: Math.max(...aqis) };
        } catch(e) { return { name, current: city.aqi }; }
    }));
    try {
        const aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const res = await aiClient.models.generateContent({ model: 'gemini-3-flash-preview', contents: `Act as a health advisor. Compare air quality for these cities: ${JSON.stringify(stats.filter(Boolean))}. Use HTML h3, p, ul tags. Keep it concise for mobile users.` });
        aiContentBody.innerHTML = res.text || 'No response.';
    } catch (e) { aiContentBody.innerHTML = '<p class="text-red-500">AI analysis unavailable.</p>'; }
    aiLoadingDiv.classList.add('hidden'); aiResultDiv.classList.remove('hidden');
}

async function refreshAll() { loader.classList.remove('hidden'); const res = await Promise.all(Object.keys(cityData).map(c => fetchCityData(c).catch(() => null))); res.forEach(r => { if(r) cityData[r.name] = r; }); loader.classList.add('hidden'); render(); }

init();