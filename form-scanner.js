// Version: 3.0

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
      img.onerror = () => reject(new Error('Failed to load image for resizing.'));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file from disk.'));
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
  
  const uploadPrompt = document.getElementById('fs-upload-prompt');
  const imgPreview = document.getElementById('fs-preview-img');
  const pdfPreview = document.getElementById('fs-pdf-preview');
  const scanBtn = document.getElementById('fs-scan-btn');
  
  // Hide prompt, reset previews
  if (uploadPrompt) uploadPrompt.style.display = 'none';
  imgPreview.style.display = 'none';
  pdfPreview.style.display = 'none';
  
  try {
    if (file.type === 'application/pdf') {
      currentFileBase64 = await readPdfAsBase64(file);
      currentMimeType = 'application/pdf';
      document.getElementById('fs-pdf-name').textContent = file.name;
      pdfPreview.style.display = 'block';
    } else if (file.type.startsWith('image/')) {
      const { base64, previewUrl } = await resizeImageToBase64(file);
      currentFileBase64 = base64;
      currentMimeType = 'image/jpeg';
      imgPreview.src = previewUrl;
      imgPreview.style.display = 'block';
    } else {
      throw new Error("Unsupported file format. Please upload a PDF or an Image.");
    }
    
    scanBtn.disabled = false;
    scanBtn.style.opacity = '1';
    setStatus('File ready for analysis.');
  } catch (err) {
    setStatus(err.message || 'File processing failed.', true);
  }
}

async function runScan() {
  if (!currentFileBase64) return setStatus('Select a file first.', true);

  const btn = document.getElementById('fs-scan-btn');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  setStatus('Analyzing layout & mapping fields via AI proxy...');

  try {
    const noteEl = document.getElementById('fs-note');
    const note = noteEl ? noteEl.value.trim() : '';
    
    const response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: currentFileBase64, mime_type: currentMimeType, note }),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`Server Error (${response.status}): The backend is not returning valid JSON. Route may be missing.`);
    }

    if (!response.ok) throw new Error(data.error || `Scan failed with status ${response.status}.`);
    
    if (!data.recognized) {
      setStatus('Form format unrecognized. Please ensure the document is clear.', true);
      btn.disabled = false;
      btn.style.opacity = '1';
      return;
    }

    lastResult = data;
    setStatus('Form structure mapped successfully!');
  } catch (err) {
    setStatus(err.message || 'Error occurred during scan.', true);
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// Initialization and Drag-and-Drop Setup
let rzInitialized = false;
function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  const photoInput = document.getElementById('fs-photo-input');
  const dropZone = document.getElementById('fs-upload-zone');
  const scanBtn = document.getElementById('fs-scan-btn');

  // 1. File Input Change Event
  if (photoInput) photoInput.addEventListener('change', handleFileSelect);

  // 2. Click to Upload
  if (dropZone && photoInput) {
    dropZone.addEventListener('click', (e) => {
      // Prevent triggering if they click the image or text inside
      if (e.target !== photoInput) {
        photoInput.click();
      }
    });

    // 3. Drag and Drop Events
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--accent, #1F6F5C)';
      dropZone.style.backgroundColor = '#e8f0ee';
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--line, #D8DCD3)';
      dropZone.style.backgroundColor = 'transparent';
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--line, #D8DCD3)';
      dropZone.style.backgroundColor = 'transparent';
      
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        photoInput.files = e.dataTransfer.files;
        // Manually dispatch change event so handleFileSelect fires
        photoInput.dispatchEvent(new Event('change'));
      }
    });
  }

  if (scanBtn) scanBtn.addEventListener('click', runScan);
}

document.addEventListener('DOMContentLoaded', init);
