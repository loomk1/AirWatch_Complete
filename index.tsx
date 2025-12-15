import { GoogleGenAI } from "@google/genai";

declare const Chart: any;
declare const L: any;

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const API_KEY = "bf57504e06985889868020dc567d8730";
const DEFAULT_CITIES = ["Pune", "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai"];

// State
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
}

let cityData: Record<string, CityData> = {};
let selectedCities = new Set<string>();
let currentView: 'grid' | 'map' = 'grid';
let mapInstance: any = null;
let mapMarkers: any[] = [];

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

const viewGridBtn = document.getElementById('view-grid-btn')!;
const viewMapBtn = document.getElementById('view-map-btn')!;

// Chart Instances
let aqiChartInstance: any = null;
let tempChartInstance: any = null;
let humChartInstance: any = null;
let historyChartInstance: any = null;
let cityHistoryChartInstance: any = null;

// --- Initialization ---

async function init() {
  loader.classList.remove('hidden');
  cardsContainer.innerHTML = '';
  
  // Setup Event Listeners
  setupEventListeners();

  const promises = DEFAULT_CITIES.map(c => fetchCityData(c));
  const results = await Promise.all(promises);
  
  results.forEach(res => {
      if(res) cityData[res.name] = res;
  });

  loader.classList.add('hidden');
  render();
}

function setupEventListeners() {
  document.getElementById('refreshAllBtn')?.addEventListener('click', refreshAll);
  document.getElementById('compareBtn')?.addEventListener('click', openCompareModal);
  document.getElementById('addCityBtn')?.addEventListener('click', openAddModal);
  
  document.getElementById('closeAddModalBtn')?.addEventListener('click', closeAddModal);
  document.getElementById('cancelAddBtn')?.addEventListener('click', closeAddModal);
  document.getElementById('confirmAddBtn')?.addEventListener('click', handleAddCity);
  
  document.getElementById('closeCompareModalBtn')?.addEventListener('click', closeCompareModal);
  
  document.getElementById('closeCityHistoryModalBtn')?.addEventListener('click', closeCityHistoryModal);

  // View Switcher
  viewGridBtn?.addEventListener('click', () => switchView('grid'));
  viewMapBtn?.addEventListener('click', () => switchView('map'));

  // Tabs
  document.getElementById('tab-btn-table')?.addEventListener('click', () => switchCompareTab('table'));
  document.getElementById('tab-btn-charts')?.addEventListener('click', () => switchCompareTab('charts'));
  document.getElementById('tab-btn-history')?.addEventListener('click', () => switchCompareTab('history'));
  document.getElementById('tab-btn-insights')?.addEventListener('click', () => switchCompareTab('insights'));
  
  document.getElementById('mob-tab-table')?.addEventListener('click', () => switchCompareTab('table'));
  document.getElementById('mob-tab-charts')?.addEventListener('click', () => switchCompareTab('charts'));
  document.getElementById('mob-tab-history')?.addEventListener('click', () => switchCompareTab('history'));
  document.getElementById('mob-tab-insights')?.addEventListener('click', () => switchCompareTab('insights'));

  cityInput?.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') handleAddCity();
  });
}

// --- Logic ---

function getAqiInfo(aqi: number) {
  if (aqi <= 50) return { 
      label: 'Good', 
      color: 'text-green-400', 
      border: 'border-green-500', 
      pill: 'bg-green-900/50 text-green-300 border-green-700', 
      hex: '#4ade80',
      bg: 'bg-gradient-to-br from-gray-800 to-green-900/30',
      barGradient: 'bg-gradient-to-r from-green-500 to-emerald-600'
  };
  if (aqi <= 100) return { 
      label: 'Moderate', 
      color: 'text-yellow-400', 
      border: 'border-yellow-500', 
      pill: 'bg-yellow-900/50 text-yellow-300 border-yellow-700', 
      hex: '#facc15',
      bg: 'bg-gradient-to-br from-gray-800 to-yellow-900/30',
      barGradient: 'bg-gradient-to-r from-yellow-400 to-yellow-600'
  };
  if (aqi <= 150) return { 
      label: 'Sensitive', 
      color: 'text-orange-400', 
      border: 'border-orange-500', 
      pill: 'bg-orange-900/50 text-orange-300 border-orange-700', 
      hex: '#fb923c',
      bg: 'bg-gradient-to-br from-gray-800 to-orange-900/30',
      barGradient: 'bg-gradient-to-r from-orange-400 to-orange-600'
  };
  if (aqi <= 200) return { 
      label: 'Unhealthy', 
      color: 'text-red-400', 
      border: 'border-red-500', 
      pill: 'bg-red-900/50 text-red-300 border-red-700', 
      hex: '#f87171',
      bg: 'bg-gradient-to-br from-gray-800 to-red-900/30',
      barGradient: 'bg-gradient-to-r from-red-500 to-red-600'
  };
  if (aqi <= 300) return { 
      label: 'Very Unhealthy', 
      color: 'text-purple-400', 
      border: 'border-purple-500', 
      pill: 'bg-purple-900/50 text-purple-300 border-purple-700', 
      hex: '#c084fc',
      bg: 'bg-gradient-to-br from-gray-800 to-purple-900/30',
      barGradient: 'bg-gradient-to-r from-purple-500 to-purple-600'
  };
  return { 
      label: 'Hazardous', 
      color: 'text-rose-400', 
      border: 'border-rose-600', 
      pill: 'bg-rose-900/50 text-rose-300 border-rose-800', 
      hex: '#fb7185',
      bg: 'bg-gradient-to-br from-gray-800 to-rose-900/30',
      barGradient: 'bg-gradient-to-r from-rose-500 to-rose-700'
  };
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
  return Math.round(((Ih - Il) / (Ch - Cl)) * (C - Cl) + Il);
}

async function fetchCityData(cityName: string): Promise<CityData | null> {
  try {
      const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${cityName}&units=metric&appid=${API_KEY}`);
      if (!weatherRes.ok) throw new Error('City not found');
      const weather = await weatherRes.json();

      const airRes = await fetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${weather.coord.lat}&lon=${weather.coord.lon}&appid=${API_KEY}`);
      const air = await airRes.json();

      const pm25 = air.list[0].components.pm2_5;
      const aqi = pm25ToAQI(pm25);

      return {
          id: weather.id,
          name: weather.name,
          country: weather.sys.country,
          temp: Math.round(weather.main.temp),
          humidity: weather.main.humidity,
          aqi: aqi,
          lat: weather.coord.lat,
          lon: weather.coord.lon,
          windSpeed: weather.wind.speed,
          windDeg: weather.wind.deg,
          lastUpdated: new Date()
      };
  } catch (error) {
      console.error(error);
      alert(`Could not fetch data for ${cityName}. Please check spelling.`);
      return null;
  }
}

// --- View Logic ---

function switchView(view: 'grid' | 'map') {
    currentView = view;
    
    if (view === 'grid') {
        viewGridBtn.classList.add('bg-gray-600', 'text-white', 'shadow-sm');
        viewGridBtn.classList.remove('text-gray-400');
        viewMapBtn.classList.remove('bg-gray-600', 'text-white', 'shadow-sm');
        viewMapBtn.classList.add('text-gray-400');
        
        cardsContainer.classList.remove('hidden');
        mapViewContainer.classList.add('hidden');
    } else {
        viewMapBtn.classList.add('bg-gray-600', 'text-white', 'shadow-sm');
        viewMapBtn.classList.remove('text-gray-400');
        viewGridBtn.classList.remove('bg-gray-600', 'text-white', 'shadow-sm');
        viewGridBtn.classList.add('text-gray-400');
        
        cardsContainer.classList.add('hidden');
        mapViewContainer.classList.remove('hidden');
        
        // Leaflet needs to know it's visible to render correctly
        setTimeout(() => {
            initMap();
        }, 100);
    }
}

function initMap() {
    if (!mapInstance) {
        // Initialize Map
        mapInstance = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView([20, 78], 4); // Default center (India)

        // Add Dark Mode Tile Layer (CartoDB Dark Matter)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(mapInstance);
        
        L.control.zoom({
            position: 'bottomright'
        }).addTo(mapInstance);
    } else {
        mapInstance.invalidateSize();
    }
    
    updateMapMarkers();
}

function updateMapMarkers() {
    if (!mapInstance) return;

    // Clear existing
    mapMarkers.forEach(m => mapInstance.removeLayer(m));
    mapMarkers = [];
    
    const cities = Object.values(cityData);
    if (cities.length === 0) return;

    const bounds = L.latLngBounds([]);

    cities.forEach(city => {
        const info = getAqiInfo(city.aqi);
        
        const marker = L.circleMarker([city.lat, city.lon], {
            radius: 10,
            fillColor: info.hex,
            color: '#fff',
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.8
        }).addTo(mapInstance);

        const popupContent = `
            <div class="font-sans min-w-[150px]">
                <h3 class="font-bold text-lg text-white mb-1">${city.name}, ${city.country}</h3>
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-sm font-semibold px-2 py-0.5 rounded ${info.pill} border border-transparent">${info.label}</span>
                    <span class="text-sm text-gray-300">AQI: ${city.aqi}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-sm text-gray-300">
                    <div class="flex items-center gap-1">
                        <span class="text-orange-400">Temp:</span> ${city.temp}°C
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="text-blue-400">Hum:</span> ${city.humidity}%
                    </div>
                    <div class="col-span-2 flex items-center gap-1">
                         <span class="text-teal-400">Wind:</span> ${city.windSpeed}m/s
                    </div>
                </div>
            </div>
        `;
        
        marker.bindPopup(popupContent);
        mapMarkers.push(marker);
        bounds.extend([city.lat, city.lon]);
    });

    if (mapMarkers.length > 0) {
        mapInstance.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
    }
}

// --- Card Logic ---

(window as any).toggleSelection = (cityName: string, isChecked: boolean) => {
  if (isChecked) {
      selectedCities.add(cityName);
  } else {
      selectedCities.delete(cityName);
  }
  updateCompareButton();
};

(window as any).refreshCity = async (name: string) => {
    const data = await fetchCityData(name);
    if(data) {
        cityData[name] = data;
        render();
    }
};

(window as any).removeCity = (name: string) => {
    if(confirm(`Remove ${name}?`)) {
        delete cityData[name];
        selectedCities.delete(name);
        render();
    }
};

(window as any).viewHistory = (name: string) => {
    const data = cityData[name];
    if (data) {
        openCityHistory(data);
    }
}

function updateCompareButton() {
  const count = selectedCities.size;
  const countSpan = document.getElementById('compareCount')!;
  
  countSpan.innerText = count.toString();
  if (count > 0) {
      countSpan.classList.remove('hidden');
  } else {
      countSpan.classList.add('hidden');
  }
}

function render() {
  cardsContainer.innerHTML = '';
  const cities = Object.keys(cityData);
  
  // Render cards
  if(cities.length === 0) {
      cardsContainer.innerHTML = `<div class="col-span-full text-center py-20 text-gray-500">No cities added. Add a city to get started.</div>`;
  } else {
      cities.forEach(city => {
          const data = cityData[city];
          if(data) {
              cardsContainer.innerHTML += createCardHTML(data);
          }
      });
  }
  
  updateCompareButton();
  
  // If map is visible, update markers too
  if (currentView === 'map') {
      updateMapMarkers();
  }
}

function createCardHTML(data: CityData) {
  const aqiInfo = getAqiInfo(data.aqi);
  const isSelected = selectedCities.has(data.name);
  
  return `
  <div class="relative ${aqiInfo.bg} rounded-[1.5rem] shadow-card hover:shadow-card-hover hover:scale-[1.01] transition-all duration-300 overflow-hidden group border border-gray-700/60">
      <div class="absolute top-0 left-0 w-full h-1.5 ${aqiInfo.barGradient}"></div>
      
      <div class="px-6 pt-6 pb-2 flex justify-between items-start relative z-10">
          <div class="flex items-center gap-1.5 text-gray-400 font-medium text-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span>${data.country}</span>
          </div>
          <div class="flex items-center gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-200">
               <button onclick="viewHistory('${data.name}')" class="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded border border-gray-600 transition-colors">
                  History
              </button>
              <button onclick="refreshCity('${data.name}')" class="text-gray-400 hover:text-white transition-colors p-1" title="Refresh">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              </button>
              <button onclick="removeCity('${data.name}')" class="text-gray-400 hover:text-red-400 transition-colors p-1" title="Remove">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
              <label class="flex items-center cursor-pointer ml-1">
                   <input type="checkbox" onchange="toggleSelection('${data.name}', this.checked)" ${isSelected ? 'checked' : ''} class="w-5 h-5 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500 transition duration-150 ease-in-out cursor-pointer">
              </label>
          </div>
      </div>

      <div class="px-6 mb-4 relative z-10 cursor-pointer" onclick="viewHistory('${data.name}')">
          <h2 class="text-3xl font-bold text-gray-100 tracking-tight leading-none group-hover:text-white transition-colors">${data.name}</h2>
      </div>

      <div class="px-6 pb-6 flex gap-6 relative z-10">
          <div class="flex flex-col items-center cursor-pointer justify-center" onclick="viewHistory('${data.name}')">
              <span class="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-3">AIR QUALITY</span>
              <div class="w-24 h-24 rounded-full border-[6px] ${aqiInfo.border} bg-gray-800/80 backdrop-blur-sm flex items-center justify-center relative shadow-sm group-hover:scale-105 transition-transform duration-300">
                  <span class="text-3xl font-bold text-gray-100">${data.aqi}</span>
              </div>
              <div class="mt-3 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${aqiInfo.pill} text-center min-w-[80px]">
                  ${aqiInfo.label}
              </div>
          </div>

          <div class="flex-1 flex flex-col gap-3 justify-center">
              <div class="flex items-center gap-3 p-3 bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700/50">
                  <div class="w-10 h-10 rounded-full bg-gray-700 shadow-md flex items-center justify-center text-orange-400 shrink-0">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                  </div>
                  <div class="flex flex-col">
                      <span class="text-xs text-gray-400 font-medium">Temperature</span>
                      <span class="text-xl font-bold text-gray-100 leading-none">${data.temp}°C</span>
                  </div>
              </div>

              <div class="flex items-center gap-3 p-3 bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700/50">
                  <div class="w-10 h-10 rounded-full bg-gray-700 shadow-md flex items-center justify-center text-sky-400 shrink-0">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
                  </div>
                  <div class="flex flex-col">
                      <span class="text-xs text-gray-400 font-medium">Humidity</span>
                      <span class="text-xl font-bold text-gray-100 leading-none">${data.humidity}%</span>
                  </div>
              </div>

               <div class="flex items-center gap-3 p-3 bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700/50">
                  <div class="w-10 h-10 rounded-full bg-gray-700 shadow-md flex items-center justify-center text-teal-400 shrink-0">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div class="flex flex-col">
                      <span class="text-xs text-gray-400 font-medium">Wind</span>
                      <div class="flex items-center gap-2">
                        <span class="text-xl font-bold text-gray-100 leading-none">${data.windSpeed}<span class="text-sm font-normal text-gray-400 ml-0.5">m/s</span></span>
                         <svg class="w-4 h-4 text-teal-400" style="transform: rotate(${data.windDeg}deg)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      <div class="px-6 pb-5 text-center relative z-10">
          <p class="text-[10px] text-gray-500 font-medium">Last updated: Just now</p>
      </div>
  </div>
  `;
}

// --- Modals & Comparison ---

function openAddModal() {
  addModal.classList.remove('hidden');
  addModal.classList.remove('opacity-0');
  setTimeout(() => {
      addModal.querySelector('div')!.classList.remove('scale-95');
      addModal.querySelector('div')!.classList.add('scale-100');
      cityInput.focus();
  }, 10);
}

function closeAddModal() {
  addModal.querySelector('div')!.classList.remove('scale-100');
  addModal.querySelector('div')!.classList.add('scale-95');
  addModal.classList.add('opacity-0');
  setTimeout(() => {
      addModal.classList.add('hidden');
      cityInput.value = '';
  }, 200);
}

async function handleAddCity() {
  const city = cityInput.value.trim();
  if(!city) return;
  
  const btn = document.getElementById('confirmAddBtn')!;
  const originalText = btn.innerText;
  btn.innerText = 'Searching...';
  
  const data = await fetchCityData(city);
  if(data) {
      cityData[data.name] = data;
      render();
      closeAddModal();
  }
  
  btn.innerText = originalText;
}

function openCompareModal() {
  if (selectedCities.size < 2) {
      alert('Please select at least 2 cities to compare.');
      return;
  }

  buildCompareTable();
  buildCompareCharts();
  
  // Reset tabs to table
  switchCompareTab('table');

  compareModal.classList.remove('hidden');
  compareModal.classList.remove('opacity-0');
  setTimeout(() => {
      compareModal.querySelector('div')!.classList.remove('scale-95');
      compareModal.querySelector('div')!.classList.add('scale-100');
  }, 10);
}

function closeCompareModal() {
  compareModal.querySelector('div')!.classList.remove('scale-100');
  compareModal.querySelector('div')!.classList.add('scale-95');
  compareModal.classList.add('opacity-0');
  setTimeout(() => {
      compareModal.classList.add('hidden');
  }, 200);
}

function switchCompareTab(tab: 'table' | 'charts' | 'history' | 'insights') {
    // Hide all contents
    document.getElementById('compare-view-table')?.classList.add('hidden');
    document.getElementById('compare-view-charts')?.classList.add('hidden');
    document.getElementById('compare-view-history')?.classList.add('hidden');
    document.getElementById('compare-view-insights')?.classList.add('hidden');

    // Show selected content
    document.getElementById(`compare-view-${tab}`)?.classList.remove('hidden');

    // Update Tab Styles (Desktop)
    const tabs = ['table', 'charts', 'history', 'insights'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        if (t === tab) {
            btn?.classList.add('bg-gray-600', 'text-white', 'shadow-sm');
            btn?.classList.remove('text-gray-400', 'hover:text-gray-200');
        } else {
            btn?.classList.remove('bg-gray-600', 'text-white', 'shadow-sm');
            btn?.classList.add('text-gray-400', 'hover:text-gray-200');
        }
    });

    // Update Tab Styles (Mobile)
    tabs.forEach(t => {
        const btn = document.getElementById(`mob-tab-${t}`);
        if (t === tab) {
            btn?.classList.add('bg-gray-700', 'text-white');
            btn?.classList.remove('text-gray-400');
        } else {
            btn?.classList.remove('bg-gray-700', 'text-white');
            btn?.classList.add('text-gray-400');
        }
    });

    // Trigger actions if needed
    if (tab === 'insights') {
        generateAIInsights();
    } else if (tab === 'history') {
        buildHistoryChart();
    }
}

function buildCompareTable() {
    const tbody = document.getElementById('compareTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    selectedCities.forEach(city => {
        const d = cityData[city];
        if(!d) return;
        const info = getAqiInfo(d.aqi);
        
        tbody.innerHTML += `
        <tr class="hover:bg-gray-750 transition-colors">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-100">${d.name}, ${d.country}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${info.pill}">
                    ${d.aqi}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-medium">${d.temp}°C</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-medium">${d.humidity}%</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                 <span class="${info.color} font-bold">${info.label}</span>
            </td>
        </tr>
        `;
    });
}

function buildCompareCharts() {
    const cities = Array.from(selectedCities).map(name => cityData[name]).filter(Boolean);
    if(cities.length === 0) return;

    const labels = cities.map(c => c.name);
    const aqiData = cities.map(c => c.aqi);
    const tempData = cities.map(c => c.temp);
    const humData = cities.map(c => c.humidity);
    
    // Common Options
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false }, ticks: { color: '#9ca3af' } },
            y: { grid: { color: '#374151' }, ticks: { color: '#9ca3af' }, beginAtZero: true }
        }
    };

    // AQI Chart
    if (aqiChartInstance) aqiChartInstance.destroy();
    const ctxAqi = (document.getElementById('aqiChart') as HTMLCanvasElement)?.getContext('2d');
    if (ctxAqi) {
         aqiChartInstance = new Chart(ctxAqi, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'AQI',
                    data: aqiData,
                    backgroundColor: cities.map(c => getAqiInfo(c.aqi).hex),
                    borderRadius: 4
                }]
            },
            options: commonOptions
        });
    }

    // Temp Chart
    if (tempChartInstance) tempChartInstance.destroy();
    const ctxTemp = (document.getElementById('tempChart') as HTMLCanvasElement)?.getContext('2d');
    if (ctxTemp) {
         tempChartInstance = new Chart(ctxTemp, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Temperature (°C)',
                    data: tempData,
                    backgroundColor: 'rgba(249, 115, 22, 0.8)', // Orange
                    borderRadius: 4
                }]
            },
            options: {
                ...commonOptions,
                scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, beginAtZero: false } }
            }
        });
    }
    
    // Humidity Chart
    if (humChartInstance) humChartInstance.destroy();
    const ctxHum = (document.getElementById('humChart') as HTMLCanvasElement)?.getContext('2d');
    if (ctxHum) {
         humChartInstance = new Chart(ctxHum, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Humidity (%)',
                    data: humData,
                    backgroundColor: 'rgba(56, 189, 248, 0.8)', // Sky Blue
                    borderRadius: 4
                }]
            },
            options: commonOptions
        });
    }
}

// --- Historical Data Logic for Comparison ---

async function getHistoricalData(lat: number, lon: number) {
    // 7 days ago unix timestamp
    const end = Math.floor(Date.now() / 1000);
    const start = end - (7 * 24 * 60 * 60);

    try {
        const res = await fetch(`https://api.openweathermap.org/data/2.5/air_pollution/history?lat=${lat}&lon=${lon}&start=${start}&end=${end}&appid=${API_KEY}`);
        const data = await res.json();
        return data.list || [];
    } catch (e) {
        console.error(e);
        return [];
    }
}

async function buildHistoryChart() {
    const loading = document.getElementById('history-loading')!;
    loading.classList.remove('hidden');

    if (historyChartInstance) historyChartInstance.destroy();

    const datasets: any[] = [];
    // Generate labels for X axis (Last 7 days)
    const labels: string[] = [];
    const now = new Date();
    for(let i=6; i>=0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    }

    const colorPalette = [
        '#818cf8', // Indigo
        '#f472b6', // Pink
        '#34d399', // Emerald
        '#fbbf24', // Amber
        '#60a5fa', // Blue
        '#a78bfa', // Violet
    ];

    let colorIdx = 0;

    for (const cityName of selectedCities) {
        const city = cityData[cityName];
        if(!city) continue;

        const rawData = await getHistoricalData(city.lat, city.lon);
        
        // Group by Day and average AQI
        const dailyMap = new Map<string, number[]>();
        labels.forEach(l => dailyMap.set(l, []));

        rawData.forEach((item: any) => {
            const date = new Date(item.dt * 1000);
            const key = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            
            if (dailyMap.has(key)) {
                const val = pm25ToAQI(item.components.pm2_5);
                dailyMap.get(key)!.push(val);
            }
        });

        const dataPoints = labels.map(l => {
            const vals = dailyMap.get(l);
            if (!vals || vals.length === 0) return 0;
            const sum = vals.reduce((a, b) => a + b, 0);
            return Math.round(sum / vals.length);
        });

        const color = colorPalette[colorIdx % colorPalette.length];
        
        datasets.push({
            label: city.name,
            data: dataPoints,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#1f2937',
            pointBorderWidth: 2
        });
        
        colorIdx++;
    }

    const ctx = (document.getElementById('historyChart') as HTMLCanvasElement).getContext('2d');
    
    historyChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#9ca3af', font: { family: 'Inter', size: 12 } }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#9ca3af' }
                },
                y: {
                    grid: { color: '#374151', borderDash: [5, 5] },
                    ticks: { color: '#9ca3af' },
                    beginAtZero: true,
                    title: { display: true, text: 'Avg AQI (PM2.5)', color: '#6b7280', font: { size: 10 } }
                }
            }
        }
    });

    loading.classList.add('hidden');
}

// --- City History Modal ---

async function openCityHistory(data: CityData) {
    document.getElementById('historyModalTitle')!.innerText = `${data.name} - Historical Analysis (2015-2025)`;
    const loading = document.getElementById('city-history-loading')!;
    loading.classList.remove('hidden');
    
    cityHistoryModal.classList.remove('hidden');
    cityHistoryModal.classList.remove('opacity-0');
    setTimeout(() => {
        cityHistoryModal.querySelector('div')!.classList.remove('scale-95');
        cityHistoryModal.querySelector('div')!.classList.add('scale-100');
    }, 10);

    // 1. Fetch data from Jan 1 2022 (1640995200) to Now (3 years roughly)
    const start = 1640995200; 
    const end = Math.floor(Date.now() / 1000);
    
    try {
        const res = await fetch(`https://api.openweathermap.org/data/2.5/air_pollution/history?lat=${data.lat}&lon=${data.lon}&start=${start}&end=${end}&appid=${API_KEY}`);
        
        if (!res.ok) {
            throw new Error(`API Error: ${res.status}`);
        }

        const historyData = await res.json();
        
        if (historyData.list && historyData.list.length > 0) {
            renderCityHistoryChart(historyData.list);
        } else {
             console.log("No historical data available");
             // Clear chart if no data
             if (cityHistoryChartInstance) cityHistoryChartInstance.destroy();
        }
    } catch (e) {
        console.error("Error fetching history", e);
        // Do not alert, just log
    } finally {
        loading.classList.add('hidden');
    }
}

function closeCityHistoryModal() {
    cityHistoryModal.querySelector('div')!.classList.remove('scale-100');
    cityHistoryModal.querySelector('div')!.classList.add('scale-95');
    cityHistoryModal.classList.add('opacity-0');
    setTimeout(() => {
        cityHistoryModal.classList.add('hidden');
    }, 200);
}

function renderCityHistoryChart(rawData: any[]) {
    // Aggregation: Group by Year-Month to handle large dataset
    // Key: "2015-0" (Jan 2015), Value: { sum: 0, count: 0 }
    const monthlyData = new Map<string, { sum: number, count: number, dateObj: Date }>();
    
    rawData.forEach(item => {
        const date = new Date(item.dt * 1000);
        const key = `${date.getFullYear()}-${date.getMonth()}`; // e.g. 2015-0
        
        if (!monthlyData.has(key)) {
            monthlyData.set(key, { sum: 0, count: 0, dateObj: date });
        }
        
        const entry = monthlyData.get(key)!;
        // Convert PM2.5 to AQI
        entry.sum += pm25ToAQI(item.components.pm2_5);
        entry.count++;
    });

    // Convert map to sorted arrays
    const sortedKeys = Array.from(monthlyData.keys()).sort((a, b) => {
        const [y1, m1] = a.split('-').map(Number);
        const [y2, m2] = b.split('-').map(Number);
        return (y1 * 12 + m1) - (y2 * 12 + m2);
    });

    const labels = sortedKeys.map(key => {
        const d = monthlyData.get(key)!.dateObj;
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });

    const dataPoints = sortedKeys.map(key => {
        const entry = monthlyData.get(key)!;
        return Math.round(entry.sum / entry.count);
    });

    // Destroy existing chart
    if (cityHistoryChartInstance) cityHistoryChartInstance.destroy();

    const ctx = (document.getElementById('cityHistoryChart') as HTMLCanvasElement).getContext('2d');
    
    // Create Gradient
    const gradient = ctx!.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.5)'); // Indigo
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

    cityHistoryChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Monthly Avg AQI',
                data: dataPoints,
                borderColor: '#6366f1', // Indigo 500
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 0, // Hide points for cleaner look on long history
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(17, 24, 39, 0.9)',
                    titleColor: '#f3f4f6',
                    bodyColor: '#d1d5db',
                    borderColor: '#374151',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context: any) {
                            return `Avg AQI: ${context.parsed.y}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { 
                        color: '#9ca3af',
                        maxTicksLimit: 12 // Show ~1 label per year roughly
                    } 
                },
                y: {
                    grid: { color: '#374151', borderDash: [5, 5] },
                    ticks: { color: '#9ca3af' },
                    beginAtZero: true
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });

    const loading = document.getElementById('city-history-loading');
    if (loading) loading.classList.add('hidden');
}

// --- Gemini AI Integration ---

let currentInsightsSelection = '';

async function generateAIInsights() {
    // Generate a signature for the current selection to avoid refetching
    const currentSelectionSignature = Array.from(selectedCities).sort().join(',');
    
    // If we already have results for this selection, don't refetch
    if (currentInsightsSelection === currentSelectionSignature && aiContentBody.innerHTML.trim() !== '') {
        return;
    }
    
    // Reset State
    aiLoadingDiv.classList.remove('hidden');
    aiResultDiv.classList.add('hidden');
    currentInsightsSelection = currentSelectionSignature;

    // Prepare Data for Gemini
    const citiesToAnalyze: any[] = [];
    selectedCities.forEach(city => {
        if(cityData[city]) {
            const { name, country, temp, humidity, aqi } = cityData[city];
            citiesToAnalyze.push({ name, country, temp, humidity, aqi });
        }
    });

    const prompt = `
    Analyze the environmental data for these cities:
    ${JSON.stringify(citiesToAnalyze)}

    Role: Environmental Health Expert.
    Task: Provide a concise comparative analysis.
    
    Structure your response exactly as follows (HTML format, no markdown blocks):
    1. <h3>Executive Summary</h3>: A 1-sentence overview of the comparison.
    2. <h3>Highlights</h3>: Bullet points identifying the city with the best air quality and the worst.
    3. <h3>Health Advisory</h3>: Specific, actionable advice for residents in the city with the worst AQI.
    4. <h3>Weather Context</h3>: Briefly mention how temperature/humidity might be affecting the air quality (e.g. high humidity trapping pollutants).

    Keep it professional, friendly, and easy to read. Use <strong> for emphasis.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        const htmlContent = response.text;
        
        aiContentBody.innerHTML = htmlContent;
        aiLoadingDiv.classList.add('hidden');
        aiResultDiv.classList.remove('hidden');

    } catch (error) {
        console.error("AI Error:", error);
        aiLoadingDiv.classList.add('hidden');
        aiContentBody.innerHTML = `<p class="text-red-400">Unable to generate insights at this time. Please check your connection or API key.</p>`;
        aiResultDiv.classList.remove('hidden');
    }
}

async function refreshAll() {
  loader.classList.remove('hidden');
  cardsContainer.innerHTML = ''; 
  
  const currentCities = Object.keys(cityData);
  if (currentCities.length === 0) {
       await init();
       return;
  }

  const promises = currentCities.map(c => fetchCityData(c));
  const results = await Promise.all(promises);
  
  cityData = {}; 
  results.forEach(res => {
      if(res) cityData[res.name] = res;
  });

  loader.classList.add('hidden');
  render();
}

// Start
init();
