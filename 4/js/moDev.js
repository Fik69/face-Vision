// --- Core Application Logic ---

// Get references to DOM elements
const video = document.getElementById('camera-stream');
const captureButton = document.getElementById('capture-button');
const hiddenCanvas = document.getElementById('hidden-canvas'); // Still used for initial ImageData capture
const overlayBox = document.getElementById('overlay-box');
const loadingMessage = document.getElementById('loading-message');
const context = hiddenCanvas.getContext('2d'); // Still used for initial ImageData capture
const switchCameraButton = document.getElementById('switch-camera-button');
const toggleDetectionButton = document.getElementById('toggle-detection-button');

// Main controls (outside modals)
const countrySelect = document.getElementById('country-select');
const resolutionSelect = document.getElementById('resolution-select');

// Photo Modal elements
const photoModal = document.getElementById('photo-modal');
const modalTitle = document.getElementById('modal-title');
const modalPassportPhoto = document.getElementById('modal-passport-photo');
const modalCountrySpec = document.getElementById('modal-country-spec');
const modalResolutionSpec = document.getElementById('modal-resolution-spec');
const countrySelectModal = document.getElementById('country-select-modal');
const resolutionSelectModal = document.getElementById('resolution-select-modal');
const reprocessButton = document.getElementById('reprocess-button');
const downloadButton = document.getElementById('download-button');

// Developer Settings Modal elements (These now become direct references to elements in the main DOM)
// Input Size controls
const inputSizeSlider = document.getElementById('input-size-slider');
const inputSizeNumber = document.getElementById('input-size-number');
// Score Threshold controls
const scoreThresholdSlider = document.getElementById('score-threshold-slider');
const scoreThresholdNumber = document.getElementById('score-threshold-number');
// Skip Frames controls (now with slider and number input)
const skipFramesSlider = document.getElementById('skip-frames-slider');
const skipFramesNumber = document.getElementById('skip-frames-number');

// NEW: Height Above Head controls
const heightAboveHeadSlider = document.getElementById('height-above-head-slider');
const heightAboveHeadNumber = document.getElementById('height-above-head-number');

// NEW: Face Scale controls
const faceScaleSlider = document.getElementById('face-scale-slider');
const faceScaleNumber = document.getElementById('face-scale-number');

// Custom Message Box elements
const customMessageBoxOverlay = document.getElementById('custom-message-box-overlay');
const customMessageBoxContent = customMessageBoxOverlay.querySelector('.modal-content p');
const customMessageBoxButton = customMessageBoxOverlay.querySelector('.modal-button-group button');

// Close buttons for modals (both the main photo modal and the custom message box)
const allCloseXButtons = document.querySelectorAll('.modal-close-button-x');


// --- Configuration Variables ---

// Passport photo specifications for different countries/types
const PASSPORT_SPECS = {
    'standard': { // Common for 35x45mm dimensions
        value: 'standard',
        name: 'Standard (EU/Intl)', // More descriptive label
        aspectRatio: 35 / 45, // width / height
        faceScaleHeight: 0.75, // 70-80% of photo height for face
        faceOffsetTopRatio: 0.1 // 10-12% from top for head start
    },
    'usa': { // US Passport is 2x2 inches (square)
        value: 'usa',
        name: 'USA (2x2 inch)',
        aspectRatio: 1, // perfect square
        faceScaleHeight: 0.70, // Face should be 1 to 1 3/8 inches (approx 60-75% height)
        faceOffsetTopRatio: 0.08 // Head should be 1/8 to 1/2 inch from top
    },
    // Add more country options here as needed, following the same structure
};

// Output resolution presets for the final passport photo
const OUTPUT_RESOLUTIONS = {
    'standard-res': {
        value: 'standard-res',
        name: 'Std Res (350x450)', // Shorter label with example size
        baseWidth: 350,
        baseHeight: 450
    },
    'high-res': {
        value: 'high-res',
        name: 'High Res (700x900)', // Shorter label with example size
        baseWidth: 700,
        baseHeight: 900
    },
    'super-high-res': {
        value: 'super-high-res',
        name: 'Super Res (1050x1350)', // Shorter label with example size
        baseWidth: 1050,
        baseHeight: 1350
    }
};

// Initialize current selected specs and resolution based on default HTML options
let currentSpecs = PASSPORT_SPECS[countrySelect.value || 'standard'];
let currentOutputResolution = OUTPUT_RESOLUTIONS[resolutionSelect.value || 'high-res']; // Changed default to high-res
let currentFramesToSkip = parseInt(skipFramesNumber.value);
let currentInputSize = parseInt(inputSizeNumber.value);
let currentScoreThreshold = parseFloat(scoreThresholdNumber.value);

// NEW: Initialize current developer cropping settings
let currentHeightAboveHead = parseFloat(heightAboveHeadNumber.value);
let currentFaceScale = parseFloat(faceScaleNumber.value);


let currentFacingMode = 'user';
let animationFrameId = null;
let isDetecting = true;
let frameCounter = 0; // Global frame counter for the detection loop

// Web Worker instance
let faceDetectionWorker;


// --- Utility Functions for Dropdowns and Modals ---

/**
 * Populates a given select element with options from an object.
 * @param {HTMLSelectElement} selectElement - The select element to populate.
 * @param {object} optionsData - An object where keys are option values and values are option objects with 'name' and 'value'.
 * @param {string} selectedValue - The value of the option to pre-select.
 */
function populateSelect(selectElement, optionsData, selectedValue) {
    selectElement.innerHTML = ''; // Clear existing options
    for (const key in optionsData) {
        if (optionsData.hasOwnProperty(key)) {
            const option = document.createElement('option');
            option.value = optionsData[key].value;
            option.textContent = optionsData[key].name;
            if (optionsData[key].value === selectedValue) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        }
    }
}

/**
 * Displays a modal by adding the 'visible' class.
 * @param {HTMLElement} modalElement - The modal element to display.
 */
function showModal(modalElement) {
    modalElement.classList.add('visible');
}

/**
 * Hides a modal by removing the 'visible' class.
 * @param {HTMLElement} modalElement - The modal element to hide.
 */
function hideModal(modalElement) {
    modalElement.classList.remove('visible');
}

// --- Camera Management ---

/**
 * Initializes the camera stream based on the specified facingMode.
 * Stops any existing stream before starting a new one.
 * @param {string} facingMode - 'user' for front camera, 'environment' for rear camera.
 */
async function initCamera(facingMode) {
    // Stop any existing camera stream tracks to release the camera
    if (video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
    }

    // Hide the overlay and disable controls while switching/loading
    overlayBox.style.display = 'none';
    captureButton.disabled = true;
    switchCameraButton.disabled = true;
    toggleDetectionButton.disabled = true;
    countrySelect.disabled = true;
    resolutionSelect.disabled = true;

    // Also disable the inline dev settings sliders
    inputSizeSlider.disabled = true;
    inputSizeNumber.disabled = true;
    scoreThresholdSlider.disabled = true;
    scoreThresholdNumber.disabled = true;
    skipFramesSlider.disabled = true;
    skipFramesNumber.disabled = true;

    // NEW: Disable new developer controls
    heightAboveHeadSlider.disabled = true;
    heightAboveHeadNumber.disabled = true;
    faceScaleSlider.disabled = true;
    faceScaleNumber.disabled = true;


    loadingMessage.style.display = 'block';
    loadingMessage.textContent = `Accessing ${facingMode === 'user' ? 'front' : 'rear'} camera...`;

    try {
        // Request access to the user's camera with specified facingMode
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode } });
        video.srcObject = stream;

        // Update video transform based on facing mode for correct mirroring
        video.style.transform = (facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)');
        currentFacingMode = facingMode; // Update the global facing mode variable

        // When video metadata is loaded, play the video and load ML models
        video.onloadedmetadata = () => {
            video.play();
            loadingMessage.textContent = "Loading AI models...";
            // Instead of direct loading, tell the worker to load models
            if (faceDetectionWorker) {
                faceDetectionWorker.postMessage({ type: 'loadModels' });
            } else {
                console.error("Worker not initialized!");
            }
        };
    } catch (err) {
        console.error("Error accessing camera: ", err);
        loadingMessage.textContent = "Error: Camera access denied or not available. Please ensure HTTPS and granted permissions.";
        // Show a user-friendly message in the photo modal
        modalTitle.textContent = "Camera Access Denied!";
        modalPassportPhoto.style.display = 'none';
        modalCountrySpec.textContent = "Please allow camera access and ensure you are on HTTPS.";
        modalResolutionSpec.textContent = ""; // Clear resolution spec
        showModal(photoModal);

        // Ensure all buttons remain disabled on error
        captureButton.disabled = true;
        switchCameraButton.disabled = true;
        toggleDetectionButton.disabled = true;
        countrySelect.disabled = true;
        resolutionSelect.disabled = true;

        // Keep inline dev settings sliders disabled
        inputSizeSlider.disabled = true;
        inputSizeNumber.disabled = true;
        scoreThresholdSlider.disabled = true;
        scoreThresholdNumber.disabled = true;
        skipFramesSlider.disabled = true;
        skipFramesNumber.disabled = true;

        // NEW: Keep new developer controls disabled
        heightAboveHeadSlider.disabled = true;
        heightAboveHeadNumber.disabled = true;
        faceScaleSlider.disabled = true;
        faceScaleNumber.disabled = true;
    }
}

// --- Worker Initialization and Communication ---

/**
 * Initializes the Web Worker and sets up message listeners.
 */
function initWorker() {
    faceDetectionWorker = new Worker('worker.js'); // Path to your worker script

    faceDetectionWorker.onmessage = (event) => {
        const { type, detection, outputImageURL, message, details } = event.data;

        switch (type) {
            case 'modelsLoaded':
                console.log("Main Thread: Models reported as loaded by worker.");
                loadingMessage.style.display = 'none'; // Hide loading message
                captureButton.disabled = false; // Enable the capture button
                switchCameraButton.disabled = false; // Enable switch camera button
                toggleDetectionButton.disabled = false; // Enable toggle detection button

                // Populate and enable dropdowns
                populateSelect(countrySelect, PASSPORT_SPECS, 'standard');
                populateSelect(resolutionSelect, OUTPUT_RESOLUTIONS, 'high-res');
                countrySelect.disabled = false;
                resolutionSelect.disabled = false;

                // Enable inline dev settings controls (sliders and numbers)
                inputSizeSlider.disabled = false;
                inputSizeNumber.disabled = false;
                scoreThresholdSlider.disabled = false;
                scoreThresholdNumber.disabled = false;
                skipFramesSlider.disabled = false;
                skipFramesNumber.disabled = false;

                // NEW: Enable new developer controls
                heightAboveHeadSlider.disabled = false;
                heightAboveHeadNumber.disabled = false;
                faceScaleSlider.disabled = false;
                faceScaleNumber.disabled = false;

                startFaceDetectionLoop(); // Start continuous face detection for the overlay
                break;
            case 'detectionResult':
                if (detection) {
                    overlayBox.style.left = `${detection.x}px`;
                    overlayBox.style.top = `${detection.y}px`;
                    overlayBox.style.width = `${detection.width}px`;
                    overlayBox.style.height = `${detection.height}px`;
                    overlayBox.style.display = 'block'; // Show the overlay
                } else {
                    overlayBox.style.display = 'none'; // Hide if no face detected
                }
                break;
            case 'imageProcessed':
                let modalMessage = "No face detected in the photo!";
                if (outputImageURL) {
                    modalMessage = "Your Passport Photo:";
                }
                modalTitle.textContent = modalMessage;
                modalPassportPhoto.src = outputImageURL || '';
                modalPassportPhoto.style.display = outputImageURL ? 'block' : 'none';
                modalCountrySpec.textContent = `Country/Type: ${currentSpecs.name} (Dev Overrides Applied)`;
                modalResolutionSpec.textContent = `Output Resolution: ${currentOutputResolution.name}`;

                populateSelect(countrySelectModal, PASSPORT_SPECS, currentSpecs.value);
                populateSelect(resolutionSelectModal, OUTPUT_RESOLUTIONS, currentOutputResolution.value);
                showModal(photoModal);
                break;
            case 'error':
                console.error("Worker Error:", message, details);
                // Display user-friendly error message
                modalTitle.textContent = `Error: ${message}`;
                modalPassportPhoto.style.display = 'none';
                modalCountrySpec.textContent = details || "An unknown error occurred.";
                modalResolutionSpec.textContent = "";
                showModal(photoModal);
                break;
        }
    };

    faceDetectionWorker.onerror = (error) => {
        console.error("Worker Error Event:", error);
        modalTitle.textContent = "Fatal Error!";
        modalPassportPhoto.style.display = 'none';
        modalCountrySpec.textContent = "A critical error occurred in the processing. Please check console.";
        modalResolutionSpec.textContent = "";
        showModal(photoModal);
    };
}


/**
 * Starts the continuous face detection loop using requestAnimationFrame.
 * This loop captures video frames and sends them to the worker for detection.
 */
function startFaceDetectionLoop() {
    if (isDetecting && !animationFrameId) {
        let lastVideoTime = -1;

        async function detectFaces() {
            if (!video.paused && video.currentTime !== lastVideoTime) {
                lastVideoTime = video.currentTime;
                frameCounter++;

                // Capture the current video frame into a temporary canvas
                hiddenCanvas.width = video.videoWidth;
                hiddenCanvas.height = video.videoHeight;
                context.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

                // Get ImageData from the temporary canvas
                const imageData = context.getImageData(0, 0, hiddenCanvas.width, hiddenCanvas.height);

                // Send the ImageData and other relevant data to the worker
                // Transferable objects (like imageData.data) are more efficient
                faceDetectionWorker.postMessage({
                    type: 'detectFace',
                    payload: {
                        imageData: imageData,
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight,
                        displayWidth: video.offsetWidth, // Send display dimensions for overlay calculation
                        displayHeight: video.offsetHeight,
                        currentFramesToSkip: currentFramesToSkip,
                        frameCounter: frameCounter,
                        currentSpecs: currentSpecs, // Send current country specs
                        currentHeightAboveHead: currentHeightAboveHead, // Send dev settings
                        currentFaceScale: currentFaceScale // Send dev settings
                    }
                }, [imageData.data.buffer]); // Transfer the pixel data buffer
            }

            if (isDetecting) {
                animationFrameId = requestAnimationFrame(detectFaces);
            } else {
                animationFrameId = null;
            }
        }
        animationFrameId = requestAnimationFrame(detectFaces);
        toggleDetectionButton.textContent = 'Pause Detector';
    }
}

/**
 * Stops the continuous face detection loop.
 */
function stopFaceDetectionLoop() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        overlayBox.style.display = 'none';
        toggleDetectionButton.textContent = 'Start Detector';
    }
}

// --- Event Listeners (Main Controls) ---

/**
 * Event listener for the capture button.
 * Captures the current video frame, sends it to the worker for processing.
 */
captureButton.addEventListener('click', async () => {
    // Draw the current video frame to a hidden canvas at its native resolution
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

    // Get ImageData from the temporary canvas
    const imageData = context.getImageData(0, 0, hiddenCanvas.width, hiddenCanvas.height);

    // When capturing, we want to use the currently selected country's aspect ratio
    // but the developer's height above head and face scale settings for precise cropping.
    const specsForCapture = {
        aspectRatio: currentSpecs.aspectRatio,
        faceScaleHeight: currentFaceScale, // Use developer value
        faceOffsetTopRatio: currentHeightAboveHead // Use developer value
    };

    // Send the ImageData and specs to the worker for processing
    faceDetectionWorker.postMessage({
        type: 'processImage',
        payload: {
            imageData: imageData,
            specs: specsForCapture,
            resolution: currentOutputResolution
        }
    }, [imageData.data.buffer]); // Transfer the pixel data buffer
});

/**
 * Event listener for the "Switch Camera" button.
 * Toggles between front and rear cameras and re-initializes the stream.
 */
switchCameraButton.addEventListener('click', () => {
    currentFacingMode = (currentFacingMode === 'user' ? 'environment' : 'user');
    stopFaceDetectionLoop();
    initCamera(currentFacingMode);
});

/**
 * Event listener for the "Pause/Start Detector" button.
 * Toggles the face detection loop on or off.
 */
toggleDetectionButton.addEventListener('click', () => {
    isDetecting = !isDetecting;
    if (isDetecting) {
        startFaceDetectionLoop();
    } else {
        stopFaceDetectionLoop();
    }
});

/**
 * Event listener for the main country selection dropdown.
 * Updates the current passport photo specifications.
 */
countrySelect.addEventListener('change', (event) => {
    currentSpecs = PASSPORT_SPECS[event.target.value];
    console.log(`Passport specs set to: ${currentSpecs.name}`);
    // Re-start detection to update overlay instantly when country changes
    if (isDetecting) {
        stopFaceDetectionLoop();
        startFaceDetectionLoop();
    }
});

/**
 * Event listener for the main output resolution selection dropdown.
 * Updates the desired output resolution.
 */
resolutionSelect.addEventListener('change', (event) => {
    currentOutputResolution = OUTPUT_RESOLUTIONS[event.target.value];
    console.log(`Output resolution set to: ${currentOutputResolution.name}`);
});

// --- Event Listeners (Photo Modal Controls) ---

// Universal listener for all 'X' close buttons
allCloseXButtons.forEach(button => {
    button.addEventListener('click', (event) => {
        // Find the closest modal-overlay parent and hide it
        const modalToHide = event.target.closest('.modal-overlay');
        if (modalToHide) {
            hideModal(modalToHide);
        }
    });
});


/**
 * Event listener for the "Re-process Photo" button inside the photo modal.
 * Re-crops the currently captured image based on the selected modal specs/resolution.
 */
reprocessButton.addEventListener('click', async () => {
    const selectedModalCountryValue = countrySelectModal.value;
    const selectedModalResolutionValue = resolutionSelectModal.value;

    const newSpecs = PASSPORT_SPECS[selectedModalCountryValue];
    const newResolution = OUTPUT_RESOLUTIONS[selectedModalResolutionValue];

    if (hiddenCanvas.width === 0 || hiddenCanvas.height === 0) {
        console.error("Original image data not found in hiddenCanvas for re-processing.");
        showCustomMessageBox("Original image data not found for re-processing. Please capture a photo first.");
        return;
    }

    // Get ImageData from the temporary canvas
    const imageData = context.getImageData(0, 0, hiddenCanvas.width, hiddenCanvas.height);

    // For re-processing from the modal, we apply the modal's selected country
    // but still respect the active developer overrides for heightAboveHead and faceScale.
    const specsForReprocess = {
        aspectRatio: newSpecs.aspectRatio,
        faceScaleHeight: currentFaceScale, // Use developer value
        faceOffsetTopRatio: currentHeightAboveHead // Use developer value
    };

    // Send the ImageData and new specs to the worker for re-processing
    faceDetectionWorker.postMessage({
        type: 'processImage',
        payload: {
            imageData: imageData,
            specs: specsForReprocess,
            resolution: newResolution
        }
    }, [imageData.data.buffer]); // Transfer the pixel data buffer
});

/**
 * Event listener for the "Download Photo" button inside the photo modal.
 * Triggers download of the currently displayed passport photo.
 */
downloadButton.addEventListener('click', () => {
    const imageUrl = modalPassportPhoto.src;
    if (imageUrl && imageUrl !== '') {
        const a = document.createElement('a');
        a.href = imageUrl;
        // Generate a more descriptive filename based on specs, including dev settings for clarity
        const filename = `passport_${currentSpecs.value}_${currentOutputResolution.value}_HAH-${currentHeightAboveHead.toFixed(2)}_FS-${currentFaceScale.toFixed(2)}_${Date.now()}.png`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } else {
         // Use a custom message box instead of alert()
        showCustomMessageBox("No photo to download! Please capture or re-process a photo first.");
    }
});

// --- Event Listeners (Inline Developer Settings Controls) ---

/**
 * Event listeners for Input Size slider and number input (syncing and updating detector).
 * Sends updates to the worker.
 */
inputSizeSlider.addEventListener('input', (event) => {
    const val = parseInt(event.target.value);
    currentInputSize = val;
    inputSizeNumber.value = val;
    console.log(`Input Size set to: ${currentInputSize}`);
    faceDetectionWorker.postMessage({ type: 'updateDetectorOptions', payload: { inputSize: currentInputSize, scoreThreshold: currentScoreThreshold } });
});
inputSizeNumber.addEventListener('change', (event) => {
    let val = parseInt(event.target.value);
    const min = parseInt(inputSizeNumber.min);
    const max = parseInt(inputSizeNumber.max);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val / 32) * 32;
    event.target.value = val;
    currentInputSize = val;
    inputSizeSlider.value = val;
    console.log(`Input Size (manual) set to: ${currentInputSize}`);
    faceDetectionWorker.postMessage({ type: 'updateDetectorOptions', payload: { inputSize: currentInputSize, scoreThreshold: currentScoreThreshold } });
});

/**
 * Event listeners for Score Threshold slider and number input (syncing and updating detector).
 * Sends updates to the worker.
 */
scoreThresholdSlider.addEventListener('input', (event) => {
    const val = parseFloat(event.target.value);
    currentScoreThreshold = val;
    scoreThresholdNumber.value = val.toFixed(2);
    console.log(`Score Threshold set to: ${currentScoreThreshold}`);
    faceDetectionWorker.postMessage({ type: 'updateDetectorOptions', payload: { inputSize: currentInputSize, scoreThreshold: currentScoreThreshold } });
});
scoreThresholdNumber.addEventListener('change', (event) => {
    let val = parseFloat(event.target.value);
    const min = parseFloat(scoreThresholdNumber.min);
    const max = parseFloat(scoreThresholdNumber.max);
    const step = parseFloat(scoreThresholdNumber.step);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val * (1 / step)) / (1 / step);
    event.target.value = val.toFixed(2);
    currentScoreThreshold = val;
    scoreThresholdSlider.value = val;
    console.log(`Score Threshold (manual) set to: ${currentScoreThreshold}`);
    faceDetectionWorker.postMessage({ type: 'updateDetectorOptions', payload: { inputSize: currentInputSize, scoreThreshold: currentScoreThreshold } });
});

/**
 * Event listeners for Skip Frames slider and number input (syncing and updating detector).
 * This only affects the main thread's sending frequency, not the worker's internal logic.
 */
skipFramesSlider.addEventListener('input', (event) => {
    const val = parseInt(event.target.value);
    currentFramesToSkip = val;
    skipFramesNumber.value = val;
    console.log(`Detector update frequency: Every ${currentFramesToSkip + 1}th frame.`);
    // No need to restart detection loop, just the frame counter will adjust
});
skipFramesNumber.addEventListener('change', (event) => {
    let val = parseInt(event.target.value);
    const min = parseInt(skipFramesNumber.min);
    const max = parseInt(skipFramesNumber.max);
    val = Math.max(min, Math.min(max, val));
    event.target.value = val;
    currentFramesToSkip = val;
    skipFramesSlider.value = val;
    console.log(`Detector update frequency (manual): Every ${currentFramesToSkip + 1}th frame.`);
    // No need to restart detection loop, just the frame counter will adjust
});

// NEW: Event listeners for Height Above Head slider and number input
// These directly affect payload sent to worker for overlay/processing.
heightAboveHeadSlider.addEventListener('input', (event) => {
    const val = parseFloat(event.target.value);
    currentHeightAboveHead = val;
    heightAboveHeadNumber.value = val.toFixed(2);
    console.log(`Height Above Head (Ratio) set to: ${currentHeightAboveHead}`);
});
heightAboveHeadNumber.addEventListener('change', (event) => {
    let val = parseFloat(event.target.value);
    const min = parseFloat(heightAboveHeadNumber.min);
    const max = parseFloat(heightAboveHeadNumber.max);
    const step = parseFloat(heightAboveHeadNumber.step);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val * (1 / step)) / (1 / step);
    event.target.value = val.toFixed(2);
    currentHeightAboveHead = val;
    heightAboveHeadSlider.value = val;
    console.log(`Height Above Head (Ratio - manual) set to: ${currentHeightAboveHead}`);
});

// NEW: Event listeners for Face Scale slider and number input
// These directly affect payload sent to worker for overlay/processing.
faceScaleSlider.addEventListener('input', (event) => {
    const val = parseFloat(event.target.value);
    currentFaceScale = val;
    faceScaleNumber.value = val.toFixed(2);
    console.log(`Face Scale (Height Ratio) set to: ${currentFaceScale}`);
});
faceScaleNumber.addEventListener('change', (event) => {
    let val = parseFloat(event.target.value);
    const min = parseFloat(faceScaleNumber.min);
    const max = parseFloat(faceScaleNumber.max);
    const step = parseFloat(faceScaleNumber.step);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val * (1 / step)) / (1 / step);
    event.target.value = val.toFixed(2);
    currentFaceScale = val;
    faceScaleSlider.value = val;
    console.log(`Face Scale (Height Ratio - manual) set to: ${currentFaceScale}`);
});


/**
 * Custom Message Box Function (replaces alert())
 */
function showCustomMessageBox(message) {
    customMessageBoxContent.textContent = message;
    showModal(customMessageBoxOverlay);
}

// Event listener for the custom message box's OK button
customMessageBoxButton.addEventListener('click', () => {
    hideModal(customMessageBoxOverlay);
});


// --- Initial Application Setup ---

// Initialize the worker first, then start camera/model loading
window.addEventListener('load', () => {
    initWorker();
    initCamera(currentFacingMode);
});
