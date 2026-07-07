// Authentication check - redirect to login if not authenticated
function checkAuth() {
  const AUTH_KEY = 'inventory-tracker-auth-v1';
  const auth = localStorage.getItem(AUTH_KEY);
  if (!auth) {
    window.location.href = 'login.html';
  }
  return auth ? JSON.parse(auth) : null;
}

// Call auth check on page load
const currentAuth = checkAuth();

const STORAGE_KEY = 'inventory-tracker-state-v1';

const defaultState = {
  items: [],
  activities: []
};

function logout() {
  localStorage.removeItem('inventory-tracker-auth-v1');
  window.location.href = 'login.html';
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : defaultState;
    return {
      items: Array.isArray(parsed.items)
        ? parsed.items.map((item) => ({
            ...item,
            manufacturer: item.manufacturer || '',
            photo: item.photo || '',
            shelfLocation: item.shelfLocation || '',
            binNumber: item.binNumber || '',
            minQuantity: Number(item.minQuantity ?? 5)
          }))
        : [],
      activities: Array.isArray(parsed.activities) ? parsed.activities : []
    };
  } catch {
    return defaultState;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readPhotoAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreview(file) {
  const preview = document.getElementById('photo-preview');
  if (!file) {
    preview.innerHTML = '<span>No photo selected</span>';
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    preview.innerHTML = `<img src="${event.target.result}" alt="Selected preview" />`;
  };
  reader.readAsDataURL(file);
}

let qrStream = null;
let qrScanTimer = null;
let qrScannerActive = false;
let qrDetector = null;

function stopQrScanner() {
  qrScannerActive = false;
  if (qrScanTimer) {
    try {
      window.cancelAnimationFrame(qrScanTimer);
    } catch (e) {
      window.clearTimeout(qrScanTimer);
    }
    qrScanTimer = null;
  }
  if (qrStream) {
    qrStream.getTracks().forEach((track) => track.stop());
    qrStream = null;
  }

  const video = document.getElementById('qr-video');
  const panel = document.getElementById('qr-scanner-panel');
  const status = document.getElementById('qr-status');
  const scanButton = document.getElementById('scan-qr-button');
  const cancelButton = document.getElementById('cancel-qr-button');

  if (video) {
    video.srcObject = null;
  }
  if (panel) {
    panel.classList.add('hidden');
  }
  if (status) {
    status.textContent = 'Point the camera at a QR code to fill the form.';
  }
  if (scanButton) {
    scanButton.classList.remove('hidden');
  }
  if (cancelButton) {
    cancelButton.classList.add('hidden');
  }
}

function parseQrPayload(payload) {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Fall back to a simple text payload.
  }

  const parts = trimmed.split(/\||,/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      name: parts[0],
      sku: parts[1],
      manufacturer: parts[2] || '',
      quantity: parts[3] || '',
      shelfLocation: parts[4] || '',
      binNumber: parts[5] || ''
    };
  }

  return { sku: trimmed };
}

function applyQrDataToForm(data) {
  if (!data) return;
  const setFieldValue = (fieldId, value, fallbackName) => {
    const field = document.getElementById(fieldId) || document.querySelector(`[name="${fallbackName}"]`);
    if (field && value) {
      field.value = value;
    }
  };

  if (data.name) {
    setFieldValue('item-name', data.name, 'itemName');
  }
  if (data.sku) {
    setFieldValue('item-sku', data.sku, 'sku');
  }
  if (data.manufacturer) {
    setFieldValue('item-manufacturer', data.manufacturer, 'manufacturer');
  }
  if (data.quantity) {
    setFieldValue('item-quantity', Number(data.quantity) || 0, 'quantity');
  }
  if (data.shelfLocation || data.location) {
    setFieldValue('item-shelf-location', data.shelfLocation || data.location, 'shelfLocation');
  }
  if (data.binNumber || data.bin) {
    setFieldValue('item-bin-number', data.binNumber || data.bin, 'binNumber');
  }
}

async function scanQrFrame() {
  const video = document.getElementById('qr-video');
  const status = document.getElementById('qr-status');

  if (!qrScannerActive || !video || !video.videoWidth || !video.videoHeight) {
    qrScanTimer = window.setTimeout(scanQrFrame, 250);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  let payload = null;

  if (window.BarcodeDetector) {
    if (!qrDetector) {
      qrDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
    }
    try {
      const detected = await qrDetector.detect(canvas);
      payload = detected?.[0]?.rawValue || null;
    } catch {
      payload = null;
    }
  } else if (window.jsQR) {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const detected = window.jsQR(imageData.data, imageData.width, imageData.height);
    payload = detected?.data || null;
  }

  if (payload) {
    const data = parseQrPayload(payload);
    applyQrDataToForm(data);
    if (status) {
      status.textContent = 'QR code scanned successfully.';
    }
    stopQrScanner();
    return;
  }

  // Use requestAnimationFrame for a smoother scanning loop when possible
  qrScanTimer = window.requestAnimationFrame(scanQrFrame);
}

async function startQrScanner() {
  const video = document.getElementById('qr-video');
  const panel = document.getElementById('qr-scanner-panel');
  const status = document.getElementById('qr-status');
  const scanButton = document.getElementById('scan-qr-button');
  const cancelButton = document.getElementById('cancel-qr-button');

  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Camera access is not supported in this browser.');
    return;
  }

  if (!video || !panel || !status || !scanButton || !cancelButton) {
    return;
  }

  stopQrScanner();
  panel.classList.remove('hidden');
  scanButton.classList.add('hidden');
  cancelButton.classList.remove('hidden');
  status.textContent = 'Opening camera...';

  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.srcObject = qrStream;
    await video.play();
    // Try to enable continuous autofocus if supported by the device
    try {
      const [track] = qrStream.getVideoTracks();
      if (track && typeof track.getCapabilities === 'function' && typeof track.applyConstraints === 'function') {
        const caps = track.getCapabilities();
        const advanced = [];
        if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          advanced.push({ focusMode: 'continuous' });
        } else if (caps.focusDistance && typeof caps.focusDistance.max === 'number') {
          const ideal = (caps.focusDistance.min || 0) + ((caps.focusDistance.max - (caps.focusDistance.min || 0)) / 2);
          advanced.push({ focusDistance: ideal });
        }
        if (advanced.length) {
          await track.applyConstraints({ advanced });
        }
      }
    } catch (e) {
      // Non-fatal: some browsers/devices won't support these constraints
      console.debug('Autofocus constraints not applied', e);
    }

    // Add a tap-to-focus handler for devices/browsers that respond to a capture trigger
    try {
      const [videoTrack] = qrStream.getVideoTracks();
      const videoClickHandler = async () => {
        try {
          if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
            // Try a single-shot focus request
            await videoTrack.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
          }
        } catch (err) {
          console.debug('applyConstraints focus attempt failed', err);
        }

        // Use ImageCapture.takePhoto() to trigger autofocus on some devices
        try {
          if (window.ImageCapture) {
            const imageCapture = new ImageCapture(videoTrack);
            // takePhoto may trigger autofocus; we ignore the resulting blob
            await imageCapture.takePhoto();
          }
        } catch (err) {
          console.debug('ImageCapture focus trigger failed', err);
        }
      };

      video.addEventListener('click', videoClickHandler);
      // Remove listener when scanner stops
      const cleanupFocusListener = () => video.removeEventListener('click', videoClickHandler);
      video.addEventListener('ended', cleanupFocusListener);
      video.addEventListener('pause', cleanupFocusListener);
    } catch (e) {
      console.debug('Tap-to-focus setup failed', e);
    }
    qrScannerActive = true;
    status.textContent = 'Point the camera at a QR code to fill the form.';
    scanQrFrame();
  } catch (error) {
    console.error('Unable to start QR scanner', error);
    status.textContent = 'Camera access was denied.';
    stopQrScanner();
  }
}

function render() {
  const state = loadState();
  const inventoryTableBody = document.getElementById('inventory-table-body');
  const activityList = document.getElementById('activity-list');
  const lowStockList = document.getElementById('low-stock-list');
  const summaryCount = document.getElementById('summary-count');
  const inventoryTotal = document.getElementById('inventory-total');
  const movementItemSelect = document.getElementById('movement-item');

  const totalItems = state.items.length;
  const totalStock = state.items.reduce((sum, item) => sum + item.quantity, 0);

  if (summaryCount) {
    summaryCount.textContent = totalItems;
  }

  if (inventoryTotal) {
    inventoryTotal.textContent = `${totalStock} units`;
  }

  if (movementItemSelect) {
    movementItemSelect.innerHTML = '';
    if (state.items.length === 0) {
      movementItemSelect.innerHTML = '<option value="">No items yet</option>';
    } else {
      state.items.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.name} (${item.sku})`;
        movementItemSelect.appendChild(option);
      });
    }
  }

  if (inventoryTableBody) {
    inventoryTableBody.innerHTML = '';
    state.items.forEach((item) => {
      const row = document.createElement('tr');
      const minimumQuantity = Number(item.minQuantity ?? 5);
      const status = item.quantity <= 0 ? 'Out of stock' : item.quantity <= minimumQuantity ? 'Low stock' : 'In stock';
      const photoCell = item.photo
        ? `<img class="item-thumbnail" src="${item.photo}" alt="${item.name}" />`
        : '<span class="muted">No image</span>';

      row.innerHTML = `
        <td>${item.name}</td>
        <td>${item.sku}</td>
        <td>${item.manufacturer || '—'}</td>
        <td>${item.quantity}</td>
        <td>${status}</td>
        <td>${photoCell}</td>
      `;
      inventoryTableBody.appendChild(row);
    });
  }

  if (lowStockList) {
    lowStockList.innerHTML = '';
    const lowStockItems = state.items.filter((item) => item.quantity <= Number(item.minQuantity ?? 5));
    if (lowStockItems.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.textContent = 'No low stock items at the moment.';
      lowStockList.appendChild(emptyItem);
    } else {
      lowStockItems.forEach((item) => {
        const stockItem = document.createElement('li');
        stockItem.textContent = `${item.name} (${item.sku}) — ${item.quantity} remaining (min ${item.minQuantity ?? 5})`;
        lowStockList.appendChild(stockItem);
      });
    }
  }

  if (activityList) {
    activityList.innerHTML = '';
    const recentActivities = state.activities.slice(-10).reverse();
    recentActivities.forEach((activity) => {
      const item = document.createElement('li');
      const userLabel = activity.user ? ` by ${activity.user}` : '';
      const projectLabel = activity.project ? ` [Project: ${activity.project}]` : '';
      item.textContent = `${activity.timestamp}${userLabel} — ${activity.type === 'in' ? 'Stock in' : 'Stock out'} ${activity.quantity} of ${activity.itemName}${projectLabel} (${activity.note || 'No note'})`;
      activityList.appendChild(item);
    });
  }
}

async function addItem(event) {
  event.preventDefault();
  const state = loadState();
  const form = event.target;
  const data = new FormData(form);
  const photoFile = form.elements.namedItem('photo').files[0];
  const photo = photoFile ? await readPhotoAsDataUrl(photoFile) : '';

  const item = {
    id: crypto.randomUUID(),
    name: data.get('itemName').toString().trim(),
    sku: data.get('sku').toString().trim().toUpperCase(),
    manufacturer: data.get('manufacturer').toString().trim(),
    quantity: Number(data.get('quantity')) || 0,
    minQuantity: Number(data.get('minQuantity')) || 0,
    photo
  };

  if (!item.name || !item.sku) return;

  state.items.push(item);
  state.activities.unshift({
    id: crypto.randomUUID(),
    type: 'in',
    quantity: item.quantity,
    itemName: item.name,
    user: 'Current User',
    note: item.manufacturer ? `Initial stock from ${item.manufacturer}` : 'Initial stock added',
    timestamp: new Date().toLocaleString('en-GB', { hour12: false })
  });
  saveState(state);
  form.reset();
  document.getElementById('item-quantity').value = 0;
  document.getElementById('photo-preview').innerHTML = '<span>No photo selected</span>';
  render();
}

function handleMovement(event) {
  event.preventDefault();
  const state = loadState();
  const form = event.target;
  const data = new FormData(form);
  const itemId = data.get('itemId').toString();
  const type = data.get('type').toString();
  const quantity = Number(data.get('quantity')) || 0;
  const note = data.get('note').toString().trim();

  const item = state.items.find((entry) => entry.id === itemId);
  if (!item || quantity <= 0) return;

  if (type === 'out' && item.quantity < quantity) {
    alert('Not enough stock to book out.');
    return;
  }

  item.quantity += type === 'in' ? quantity : -quantity;
  state.activities.unshift({
    id: crypto.randomUUID(),
    type,
    quantity,
    itemName: item.name,
    user: 'Current User',
    note: note || (type === 'in' ? 'Stock added' : 'Stock removed'),
    timestamp: new Date().toLocaleString('en-GB', { hour12: false })
  });
  saveState(state);
  form.reset();
  document.getElementById('movement-quantity').value = 1;
  render();
}

const addItemForm = document.getElementById('add-item-form');
const movementForm = document.getElementById('movement-form');
const itemPhoto = document.getElementById('item-photo');
const scanQrButton = document.getElementById('scan-qr-button');
const cancelQrButton = document.getElementById('cancel-qr-button');

if (addItemForm) {
  addItemForm.addEventListener('submit', addItem);
}

if (movementForm) {
  movementForm.addEventListener('submit', handleMovement);
}

if (itemPhoto) {
  itemPhoto.addEventListener('change', (event) => {
    renderPhotoPreview(event.target.files[0]);
  });
}

if (scanQrButton) {
  scanQrButton.addEventListener('click', startQrScanner);
}

if (cancelQrButton) {
  cancelQrButton.addEventListener('click', stopQrScanner);

  // Wire up QR scanner controls
  if (scanQrButton) {
    scanQrButton.addEventListener('click', (e) => {
      e.preventDefault();
      startQrScanner();
    });
  }

  if (cancelQrButton) {
    cancelQrButton.addEventListener('click', (e) => {
      e.preventDefault();
      stopQrScanner();
    });
  }
}

render();
