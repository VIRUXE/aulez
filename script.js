// Initialize map
const map = L.map('map', {
	center            : [51.5074, -0.1278],   // London coordinates
	zoom              : 10,
	zoomControl       : true,
	attributionControl: false
});

// Add monochrome tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
	attribution: '© OpenStreetMap contributors',
	className  : 'map-tiles'
}).addTo(map);

// Create custom attribution
L.control.attribution({
	position: 'bottomright',
	prefix: false
}).addAttribution('© OpenStreetMap contributors').addTo(map);

const loadingElement = document.getElementById('loading');

function hideLoading() {
	loadingElement.classList.remove('loading--visible');
}

// Custom icon styles for different camera states
const iconStyles = {
	live: L.divIcon({
		className : 'marker-wrapper',
		html      : '<span class="marker" data-status="live">●</span>',
		iconSize  : [24, 24],
		iconAnchor: [12, 12]
	}),
	anpr: L.divIcon({
		className : 'marker-wrapper',
		html      : '<span class="marker" data-status="anpr">A</span>',
		iconSize  : [24, 24],
		iconAnchor: [12, 12]
	}),
	dead: L.divIcon({
		className : 'marker-wrapper',
		html      : '<span class="marker" data-status="dead">●</span>',
		iconSize  : [24, 24],
		iconAnchor: [12, 12]
	}),
	missing: L.divIcon({
		className : 'marker-wrapper',
		html      : '<span class="marker" data-status="missing">M</span>',
		iconSize  : [24, 24],
		iconAnchor: [12, 12]
	}),
	painted: L.divIcon({
		className : 'marker-wrapper',
		html      : '<span class="marker" data-status="painted">P</span>',
		iconSize  : [24, 24],
		iconAnchor: [12, 12]
	}),
	cut: L.divIcon({
		className : 'marker-wrapper',
		html      : '<span class="marker" data-status="cut">C</span>',
		iconSize  : [24, 24],
		iconAnchor: [12, 12]
	})
};

// Function to determine marker style based on camera status
function getMarkerIcon(feature) {
	const name        = feature.properties.name || '';
	const description = feature.properties.description || '';
	
	// Determine camera status from name or description
	if (name.includes('A') || description.includes('ANPR')) return iconStyles.anpr;
	if (name.includes('M') || description.includes('Missing')) return iconStyles.missing;
	if (name.includes('P') || description.includes('Painted')) return iconStyles.painted;
	if (name.includes('C') || description.includes('Cable')) return iconStyles.cut;
	if (name.includes('X') || description.includes('Dead')) return iconStyles.dead;
	
	return iconStyles.live; // default to live
}

loadingElement.classList.add('loading--visible');

// Create marker cluster group with custom options
const markerClusterGroup = L.markerClusterGroup({
	maxClusterRadius: 80,        // Maximum radius of cluster in pixels
	spiderfyOnMaxZoom: true,     // Spread markers when zoomed to max
	showCoverageOnHover: false,  // Don't show cluster bounds on hover
	zoomToBoundsOnClick: true,   // Zoom to cluster bounds on click
	chunkedLoading: true,        // Process markers in chunks for better performance
	chunkInterval: 200,          // Time between processing chunks (ms)
	chunkDelay: 50,              // Delay before processing begins
	// Custom cluster icon
	iconCreateFunction: function(cluster) {
		const childCount = cluster.getChildCount();
		let c = ' marker-cluster-';
		if (childCount < 10) {
			c += 'small';
		} else if (childCount < 100) {
			c += 'medium';
		} else {
			c += 'large';
		}
		
		return new L.DivIcon({
			html: '<div><span>' + childCount + '</span></div>',
			className: 'marker-cluster' + c,
			iconSize: new L.Point(40, 40)
		});
	}
});

// Global collection of individual markers so they are accessible outside fetch
const markers = [];

fetch('cameras.kml')
	.then(response => response.text())
	.then(kmlText => {
		// Parse KML to GeoJSON using togeojson
		const geoJson = toGeoJSON.kml(new DOMParser().parseFromString(kmlText, 'text/xml'));
		
		// Debug: Log the first few features to understand the structure
		/* if (geoJson.features.length > 0) {
			console.log('Sample feature structure:', geoJson.features[0]);
			console.log('Geometry type:', geoJson.features[0].geometry?.type);
			console.log('Coordinates:', geoJson.features[0].geometry?.coordinates);
		} */
		
		// Separate features into point and outline features
		const pointFeatures   = [];
		const outlineFeatures = [];
		
		geoJson.features.forEach(f => {
			if (f.geometry && f.geometry.type === 'Point') {
				pointFeatures.push(f);
			} else if (f.geometry) {
				outlineFeatures.push(f);
			}
		});
		
		// Create markers from point features (populate the global markers array)
		markers.length = 0; // reset in case of re-load
		pointFeatures.forEach(feature => {
			const coords = feature.geometry.coordinates;
			if (Array.isArray(coords) && coords.length >= 2) {
				const latlng = [coords[1], coords[0]];
				if (!isNaN(latlng[0]) && !isNaN(latlng[1])) {
					const marker = L.marker(latlng, { icon: getMarkerIcon(feature) });
					if (feature.properties && feature.properties.name) {
						marker.bindPopup(`
							<div class="popup">
								<h3>${feature.properties.name}</h3>
								${feature.properties.description ? `<p>${feature.properties.description}</p>` : ''}
								<div class="popup__actions">
									<button class="btn-report" data-action="missing" data-camera="${feature.properties.name}">Missing</button>
									<button class="btn-report" data-action="painted" data-camera="${feature.properties.name}">Painted</button>
									<button class="btn-report" data-action="cut" data-camera="${feature.properties.name}">Cable&nbsp;Cut</button>
									<button class="btn-report" data-action="dead" data-camera="${feature.properties.name}">Inactive</button>
								</div>
							</div>
						`);
					}
					markers.push(marker);
				}
			}
		});
		
		// Add all point markers to cluster group
		markerClusterGroup.addLayers(markers);
		map.addLayer(markerClusterGroup);
		
		// Colour palette for outlines
		const palette = [
			'#66b3ff', // light blue
			'#ff9999', // light red
			'#99ff99', // light green
			'#ffcc99', // light orange
			'#c299ff', // light purple
			'#ffb3e6'  // light pink
		];
		// Map to store colour assignment per area key (e.g., name)
		const colourMap = new Map();
		function getAreaColour(key) {
			if (!colourMap.has(key)) {
				const idx = colourMap.size % palette.length;
				colourMap.set(key, palette[idx]);
			}
			return colourMap.get(key);
		}

		// Utility to darken a hex colour by a specified amount (-255 to 255)
		function adjustHexColor(hex, amt) {
			let usePound = false;
			let col = hex;
			if (col.startsWith('#')) {
				usePound = true;
				col = col.slice(1);
			}
			let num = parseInt(col, 16);
			let r = (num >> 16) + amt;
			let g = ((num >> 8) & 0x00ff) + amt;
			let b = (num & 0x0000ff) + amt;
			r = Math.min(255, Math.max(0, r));
			g = Math.min(255, Math.max(0, g));
			b = Math.min(255, Math.max(0, b));
			return (usePound ? '#' : '') + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
		}

		// Add outlines as a separate GeoJSON layer
		if (outlineFeatures.length) {
			const outlineLayer = L.geoJSON(outlineFeatures, {
				style: (feature) => {
					const key    = feature.properties?.name || feature.id || '';
					const colour = getAreaColour(key);
					return {
						color      : adjustHexColor(colour, -40),
						weight     : 2,
						opacity    : 0.8,
						fillColor  : colour,
						fillOpacity: 0.15
					};
				}
			}).addTo(map);

			// Add background labels for each area using centroid of bounds
			outlineLayer.eachLayer(layer => {
				if (layer.feature) {
					const name = layer.feature.properties?.name;
					if (name) {
						const centre = layer.getBounds().getCenter();
						L.marker(centre, {
							icon: L.divIcon({
								className: 'area-label',
								html     : name,
								iconSize : null
							}),
							interactive: false,
							pane       : 'overlayPane'
						}).addTo(map);
					}
				}
			});
		}
		
		// Fit map to camera locations if available, else to outlines
		if (markers.length > 0) {
			map.fitBounds(markerClusterGroup.getBounds(), { padding: [20, 20] });
		} else if (outlineFeatures.length) {
			map.fitBounds(L.geoJSON(outlineFeatures).getBounds(), { padding: [20, 20] });
		}
		
		// After the map has been fitted, ensure only visible markers are rendered
		updateVisibleMarkers();
		
		hideLoading();
		
		console.log(`Loaded ${markers.length} camera locations and ${outlineFeatures.length} outline features`);
	})
	.catch(error => {
		hideLoading();
		console.error('Error loading camera data:', error);
		
		// Show error message
		const errorDiv = document.createElement('div');
		errorDiv.className = 'error-message';
		errorDiv.innerHTML = `
			<h3>Error Loading Camera Data</h3>
			<p>Unable to load camera locations. Please refresh the page to try again.</p>
		`;
		document.querySelector('.map-container').appendChild(errorDiv);
	});

// Accessibility: Add keyboard navigation support
map.on('focus', () => document.getElementById('map')?.setAttribute('tabindex', '0'));

// Handle report button clicks

document.addEventListener('click', (event) => {
	const target = event.target;
	if (target && target.classList.contains('btn-report')) {
		event.preventDefault();
		const camera = target.getAttribute('data-camera');
		const action = target.getAttribute('data-action');
		// TODO: Replace this alert with real reporting logic (API call, form, etc.)
		alert(`Report submitted for camera \"${camera}\" as: ${action}`);
	}
});

// -------------------------
// Freeze clustering settings
// -------------------------
// Pins will stop being reclustered once the map zoom exceeds this level.
// Adjust this value to suit your needs.
const FREEZE_CLUSTER_ZOOM = 16;
let clusteringFrozen      = false;

// Helper: update which markers are visible based on the current map view
function updateVisibleMarkers() {
	const bounds = map.getBounds();

	if (clusteringFrozen) {
		// When clustering is frozen, individual markers are added directly to the map
		markers.forEach(marker => {
			const inView = bounds.contains(marker.getLatLng());
			if (inView && !map.hasLayer(marker)) {
				marker.addTo(map);
			} else if (!inView && map.hasLayer(marker)) {
				map.removeLayer(marker);
			}
		});
	} else {
		// While clustering is active, maintain a cluster group containing only visible markers
		const visibleMarkers = markers.filter(marker => bounds.contains(marker.getLatLng()));
		markerClusterGroup.clearLayers();
		markerClusterGroup.addLayers(visibleMarkers);
		if (!map.hasLayer(markerClusterGroup)) {
			map.addLayer(markerClusterGroup);
		}
	}
}

// Once the user zooms beyond FREEZE_CLUSTER_ZOOM, remove the cluster group and
// add the individual markers directly to the map. This prevents the pins from
// being reclustered if the user zooms back out.
map.on('zoomend', () => {
	if (!clusteringFrozen && map.getZoom() > FREEZE_CLUSTER_ZOOM) {
		clusteringFrozen = true;
		map.removeLayer(markerClusterGroup);
		updateVisibleMarkers();
	}
});

// Update markers whenever the map is moved or zoomed
map.on('moveend', updateVisibleMarkers);