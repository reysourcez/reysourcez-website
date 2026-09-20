// Version: 2.0

const PROXY_ENDPOINT = '/api/scan'; 
let currentFileBase64 = null;
let currentMimeType = null;
let lastResult = null;

function setStatus(msg, isError = false) {
  const statusDiv = document.getElementById('fs-status');
  if (statusDiv) {
    statusDiv.textContent = msg;
    statusDiv.style.color = isError ? '#D32F2F' : '#1F6F5C';
  }
}

async function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1920;
        const MAX_HEIGHT = 1920;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve({
          base64: dataUrl.split(',')[1],
          previewUrl: dataUrl
        });
      };
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function readPdfAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed reading PDF file.'));
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  setStatus('Processing file...');
  document.getElementById('fs-upload-prompt').hidden = true;
  const imgPreview = document.getElementById('fs-preview-img');
  const pdfPreview = document.getElementById('fs-pdf-preview');
  
  try {
    if (file.type === 'application/pdf') {
      currentFileBase64 = await readPdfAsBase64(file);
      currentMimeType = 'application/pdf';
      
      imgPreview.hidden = true;
      document.getElementById('fs-pdf-name').textContent = file.name;
      pdfPreview.hidden = false;
    } else if (file.type.startsWith('image/')) {
      const { base64, previewUrl } = await resizeImageToBase64(file);
      currentFileBase64 = base64;
      currentMimeType = 'image/jpeg';
      
      pdfPreview.hidden = true;
      imgPreview.src = previewUrl;
      imgPreview.hidden = false;
    } else {
      throw new Error("Unsupported file type. Please upload a PDF or an Image.");
    }
    
    document.getElementById('fs-scan-btn').disabled = false;
    setStatus('File ready for analysis.');
  } catch (err) {
    setStatus(err.message || 'File processing failed.', true);
  }
}

async function scanForm(base64Data, mimeType, note) {
  const response = await fetch(PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Data, mime_type: mimeType, note }),
  });

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Worker Error (${response.status}): Endpoint returned invalid format.`);
  }

  if (!response.ok) throw new Error(data.error || `Scan failed (${response.status}).`);
  return data;
}

async function runScan() {
  if (!currentFileBase64) return setStatus('Select a file first.', true);

  const btn = document.getElementById('fs-scan-btn');
  btn.disabled = true;
  setStatus('Analyzing layout & mapping fields via AI proxy...');

  try {
    const noteEl = document.getElementById('fs-note');
    const note = noteEl ? noteEl.value.trim() : '';
    const result = await scanForm(currentFileBase64, currentMimeType, note);
    
    if (!result.recognized) {
      setStatus('Form format unrecognized. Check document clarity.', true);
      btn.disabled = false;
      return;
    }

    lastResult = result;
    setStatus('Form structure mapped successfully!');
  } catch (err) {
    setStatus(err.message || 'Error occurred during scan.', true);
  } finally {
    btn.disabled = false;
  }
}

let rzInitialized = false;
function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  const photoInput = document.getElementById('fs-photo-input');
  if (photoInput) photoInput.addEventListener('change', handleFileSelect);

  const scanBtn = document.getElementById('fs-scan-btn');
  if (scanBtn) scanBtn.addEventListener('click', runScan);
}

document.addEventListener('DOMContentLoaded', init);
