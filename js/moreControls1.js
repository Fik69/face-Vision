// --- Core Application Logic ---

// Get references to DOM elements
const video = document.getElementById('camera-stream');
const captureButton = document.getElementById('capture-button');
const hiddenCanvas = document.getElementById('hidden-canvas');
const overlayBox = document.getElementById('overlay-box');
const loadingMessage = document.getElementById('loading-message');
const context = hiddenCanvas.getContext('2d');
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

// NEW: Face Scale and Head Offset controls
const faceScaleSlider = document.getElementById('face-scale-slider');
const faceScaleNumber = document.getElementById('face-scale-number');
const headOffsetSlider = document.getElementById('head-offset-slider');
const headOffsetNumber = document.getElementById('head-offset-number');


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
        // These are now default values, can be overridden by dev settings
        faceScaleHeight: 0.75, // 70-80% of photo height for face
        faceOffsetTopRatio: 0.1 // 10-12% from top for head start
    },
    'usa': { // US Passport is 2x2 inches (square)
        value: 'usa',
        name: 'USA (2x2 inch)',
        aspectRatio: 1, // perfect square
        // These are now default values, can be overridden by dev settings
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
let currentOutputResolution = OUTPUT_RESOLUTIONS[resolutionSelect.value || 'standard-res'];
let currentFramesToSkip = parseInt(skipFramesNumber.value); // Use number input value as initial
let currentInputSize = parseInt(inputSizeNumber.value); // Use number input value as initial
let currentScoreThreshold = parseFloat(scoreThresholdNumber.value); // Use number input value as initial

// NEW: Initialize current face scale and head offset from developer settings
let currentFaceScaleHeight = parseFloat(faceScaleNumber.value);
let currentFaceOffsetTopRatio = parseFloat(headOffsetNumber.value);


let currentFacingMode = 'user';
let animationFrameId = null;
let isDetecting = true;

// The path where face-api.js models are hosted relative to index.html
const MODELS_URL = 'face-api.js/weights';

// face-api.js TinyFaceDetector options (now a function to allow dynamic updates)
const getTinyFaceDetectorOptions = () => new faceapi.TinyFaceDetectorOptions({
    inputSize: currentInputSize, // Dynamic input size
    scoreThreshold: currentScoreThreshold // Dynamic score threshold
});

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
    faceScaleSlider.disabled = true; // NEW
    faceScaleNumber.disabled = true; // NEW
    headOffsetSlider.disabled = true; // NEW
    headOffsetNumber.disabled = true; // NEW


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
            loadModelsAndStartDetection(); // Proceed to load models (if not already loaded)
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
        faceScaleSlider.disabled = true; // NEW
        faceScaleNumber.disabled = true; // NEW
        headOffsetSlider.disabled = true; // NEW
        headOffsetNumber.disabled = true; // NEW
    }
}

// --- Model Loading ---

/**
 * Loads the necessary face-api.js models from the specified URL.
 * Once loaded, it enables the UI controls and starts the detection loop.
 */
async function loadModelsAndStartDetection() {
    try {
        // Check if models are already loaded to avoid re-loading
        if (!faceapi.nets.tinyFaceDetector.isLoaded) {
            // Load the TinyFace Detector model (includes the weights and JSON)
            await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
            console.log("face-api.js TinyFace Detector model loaded successfully.");
        } else {
            console.log("face-api.js models already loaded.");
        }

        loadingMessage.style.display = 'none'; // Hide loading message
        captureButton.disabled = false; // Enable the capture button
        switchCameraButton.disabled = false; // Enable switch camera button
        toggleDetectionButton.disabled = false; // Enable toggle detection button
        
        // Populate and enable dropdowns
        populateSelect(countrySelect, PASSPORT_SPECS, 'standard');
        populateSelect(resolutionSelect, OUTPUT_RESOLUTIONS, 'high-res'); // Using 'standard' as default key
        countrySelect.disabled = false; 
        resolutionSelect.disabled = false; 

        // Enable inline dev settings controls (sliders and numbers)
        inputSizeSlider.disabled = false;
        inputSizeNumber.disabled = false;
        scoreThresholdSlider.disabled = false;
        scoreThresholdNumber.disabled = false;
        skipFramesSlider.disabled = false;
        skipFramesNumber.disabled = false;
        faceScaleSlider.disabled = false; // NEW
        faceScaleNumber.disabled = false; // NEW
        headOffsetSlider.disabled = false; // NEW
        headOffsetNumber.disabled = false; // NEW


        startFaceDetectionLoop(); // Start continuous face detection for the overlay
    } catch (error) {
        console.error("Error loading face-api.js models:", error);
        loadingMessage.textContent = "Error loading AI models. Check console and 'face-api.js/weights' folder setup.";
        // Show a user-friendly message in the photo modal
        modalTitle.textContent = "AI Model Loading Failed!";
        modalPassportPhoto.style.display = 'none';
        modalCountrySpec.textContent = "Ensure 'face-api.js/weights' folder exists with correct files.";
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
        faceScaleSlider.disabled = true; // NEW
        faceScaleNumber.disabled = true; // NEW
        headOffsetSlider.disabled = true; // NEW
        headOffsetNumber.disabled = true; // NEW
    }
}

// --- Face Detection Loop Control ---

/**
 * Starts the continuous face detection loop using requestAnimationFrame.
 * Only detects faces on a subset of frames to improve efficiency based on currentFramesToSkip.
 */
async function startFaceDetectionLoop() {
    // Only start if detection is enabled and not already running
    if (isDetecting && !animationFrameId) {
        let lastVideoTime = -1; // Track last video time to avoid redundant detections
        let frameCounter = 0; // Initialize a frame counter for skipping frames

        async function detectFaces() {
            // Only detect if video is playing, a new frame is available, and detection is enabled
            if (!video.paused && video.currentTime !== lastVideoTime && isDetecting) {
                lastVideoTime = video.currentTime; // Update last video time
                frameCounter++; // Increment the counter

                // Perform detection only on the Nth frame, where N = currentFramesToSkip + 1
                if (frameCounter % (currentFramesToSkip + 1) === 0) {
                    // Use the function to get the latest tinyFaceDetectorOptions
                    const detections = await faceapi.detectSingleFace(video, getTinyFaceDetectorOptions());

                    if (detections) {
                        // Resize the detection results to match the video element's display size
                        const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
                        const resizedDetection = faceapi.resizeResults(detections, displaySize);
                        const box = resizedDetection.box;

                        // Update the overlay box's position and size
                        overlayBox.style.left = `${box.x}px`;
                        overlayBox.style.top = `${box.y}px`;
                        overlayBox.style.width = `${box.width}px`;
                        overlayBox.style.height = `${box.height}px`;
                        overlayBox.style.display = 'block'; // Show the overlay
                    } else {
                        overlayBox.style.display = 'none'; // Hide if no face detected
                    }
                }
            }

            // Continue the loop only if detection is still enabled
            if (isDetecting) {
                animationFrameId = requestAnimationFrame(detectFaces);
            } else {
                animationFrameId = null; // Clear the animation frame ID when stopped
            }
        }
        animationFrameId = requestAnimationFrame(detectFaces); // Start the first frame of the loop
        toggleDetectionButton.textContent = 'Pause Detector'; // Update button text
        overlayBox.style.display = 'block'; // Ensure overlay is visible if starting
    }
}

/**
 * Stops the continuous face detection loop.
 */
function stopFaceDetectionLoop() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId); // Cancel the scheduled animation frame
        animationFrameId = null; // Reset the ID
        overlayBox.style.display = 'none'; // Hide the overlay box
        toggleDetectionButton.textContent = 'Start Detector'; // Update button text
    }
}

/**
 * Processes an image from a source canvas to create a passport photo.
 * This function encapsulates the core cropping logic, allowing it to be reused
 * for initial capture and for re-processing within the modal.
 * @param {HTMLCanvasElement} sourceCanvas - The canvas containing the original image.
 * @param {object} selectedSpecs - The passport specifications to use (e.g., aspect ratio, face scale).
 * @param {object} selectedResolution - The output resolution to aim for.
 * @returns {Promise<string|null>} A promise resolving to the data URL of the cropped image or null if no face is detected.
 */
async function processImageForPassport(sourceCanvas, selectedSpecs, selectedResolution) {
    // Perform face detection on the captured static image
    // Use the function to get the latest tinyFaceDetectorOptions
    const detections = await faceapi.detectSingleFace(sourceCanvas, getTinyFaceDetectorOptions());

    if (detections) {
        const faceBox = detections.box; // Get the detected face bounding box (x, y, width, height)

        // Determine final passport photo dimensions based on selected resolution AND country aspect ratio
        let finalPassportWidth = selectedResolution.baseWidth;
        let finalPassportHeight = selectedResolution.baseHeight;

        // Adjust width/height to match the country's aspect ratio based on the largest dimension
        // This ensures the aspect ratio is correct while trying to maintain selected resolution
        if (selectedSpecs.aspectRatio > 1) { // Wider than tall
            finalPassportHeight = finalPassportWidth / selectedSpecs.aspectRatio;
        } else { // Taller than wide or square
            finalPassportWidth = finalPassportHeight * selectedSpecs.aspectRatio;
        }

        // --- Passport Cropping Logic based on current developer settings ---
        const desiredFaceScaleHeight = currentFaceScaleHeight; // Use value from dev setting
        const desiredFaceOffsetTopRatio = currentFaceOffsetTopRatio; // Use value from dev setting

        // Calculate the target height of the face within the final passport photo
        const targetFaceHeightPx = finalPassportHeight * desiredFaceScaleHeight;

        // Calculate the scaling factor needed to make the detected face match the target size
        const scaleFactor = targetFaceHeightPx / faceBox.height;

        // Calculate the ideal starting Y-coordinate for the crop on the original image
        // This ensures the top of the head is at the desired offset in the final passport photo
        const idealCropY = faceBox.y - (finalPassportHeight * desiredFaceOffsetTopRatio / scaleFactor);

        // Calculate the actual crop dimensions needed on the original image,
        // maintaining the passport photo's aspect ratio
        const cropHeightOnOriginal = fin