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
const complianceMessage = document.getElementById('compliance-message'); // New: For real-time text feedback

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

// Developer Settings elements
const inputSizeSlider = document.getElementById('input-size-slider');
const inputSizeNumber = document.getElementById('input-size-number');
const scoreThresholdSlider = document.getElementById('score-threshold-slider');
const scoreThresholdNumber = document.getElementById('score-threshold-number');
const skipFramesSlider = document.getElementById('skip-frames-slider');
const skipFramesNumber = document.getElementById('skip-frames-number');
const heightAboveHeadSlider = document.getElementById('height-above-head-slider');
const heightAboveHeadNumber = document.getElementById('height-above-head-number');
const faceScaleSlider = document.getElementById('face-scale-slider');
const faceScaleNumber = document.getElementById('face-scale-number');
const applyDevSettingsButton = document.getElementById('apply-dev-settings-button'); // New: Apply button

// New Viewfinder Developer Settings
const viewfinderResWidthSlider = document.getElementById('viewfinder-res-width-slider');
const viewfinderResWidthNumber = document.getElementById('viewfinder-res-width-number');
const viewfinderAspectRatioSlider = document.getElementById('viewfinder-aspect-ratio-slider');
const viewfinderAspectRatioNumber = document.getElementById('viewfinder-aspect-ratio-number');

// Static Guide Elements (CSS controlled)
const centerCrosshair = document.querySelector('.center-crosshair');
const shoulderLineTop = document.getElementById('shoulder-line-top');
const shoulderLineBottom = document.getElementById('shoulder-line-bottom');


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

// Compliance thresholds for overlay box color (can be tuned)
const COMPLIANCE_THRESHOLDS = {
    centerDeviationRatio: 0.05, // Max % deviation from center (width/height of overlay) for green
    scaleDeviationRatio: 0.05, // Max % deviation from target face scale for green
    headTiltDegrees: 5, // Max degrees of head tilt for green
    yellowThresholdMultiplier: 2.5 // Multiplier for yellow warning (e.g., 2.5 * green_threshold)
};


// Initialize current selected specs and resolution based on default HTML options
let currentSpecs = PASSPORT_SPECS[countrySelect.value || 'standard'];
let currentOutputResolution = OUTPUT_RESOLUTIONS[resolutionSelect.value || 'high-res'];

// Developer Settings (Current active values)
let currentInputSize = parseInt(inputSizeNumber.value);
let currentScoreThreshold = parseFloat(scoreThresholdNumber.value);
let currentFramesToSkip = parseInt(skipFramesNumber.value);
let currentHeightAboveHead = parseFloat(heightAboveHeadNumber.value);
let currentFaceScale = parseFloat(faceScaleNumber.value);
let currentViewfinderResWidth = parseInt(viewfinderResWidthNumber.value); // New
let currentViewfinderAspectRatio = parseFloat(viewfinderAspectRatioNumber.value); // New

// Temporary Developer Settings (values from sliders, applied on "Apply")
let tempInputSize = currentInputSize;
let tempScoreThreshold = currentScoreThreshold;
let tempFramesToSkip = currentFramesToSkip;
let tempHeightAboveHead = currentHeightAboveHead;
let tempFaceScale = currentFaceScale;
let tempViewfinderResWidth = currentViewfinderResWidth; // New
let tempViewfinderAspectRatio = currentViewfinderAspectRatio; // New


let currentFacingMode = 'user';
let animationFrameId = null;
let isDetecting = true;
let modelsLoadedInWorker = false;

// The path where face-api.js models are hosted relative to index.html
const MODELS_URL = 'face-api.js/weights';

// --- Web Worker Setup ---
let faceDetectionWorker;

/**
 * Initializes the Web Worker and sets up message listeners.
 */
function initializeWorker() {
    faceDetectionWorker = new Worker('js/faceDetectionWorker.js');

    faceDetectionWorker.onmessage = (event) => {
        const { type, payload } = event.data;
        switch (type) {
            case 'modelsLoaded':
                modelsLoadedInWorker = true;
                loadingMessage.style.display = 'none'; // Hide loading message
                enableMainControls(); // Enable UI controls
                startFaceDetectionLoop(); // Start continuous face detection
                break;
            case 'modelsNotReady':
                // Worker is not ready, main thread can decide to show a loading message
                // console.log("Worker models not ready, waiting...");
                break;
            case 'detectionResults':
                handleDetectionResults(payload); // Process detections received from worker
                break;
            case 'noFaceDetected':
                overlayBox.style.display = 'none';
                updateComplianceMessage('No face detected', 'red');
                hideStaticGuides(); // Hide guides if no face
                break;
            case 'error':
                console.error("Error from worker:", payload.message);
                showCustomMessageBox(`AI Detection Error: ${payload.message}`);
                disableAllControls(); // Disable UI on critical worker error
                break;
        }
    };

    faceDetectionWorker.onerror = (error) => {
        console.error("Web Worker error:", error);
        showCustomMessageBox("A critical error occurred in the AI processing. Please reload.");
        disableAllControls();
    };

    // Initial message to worker to load models and set initial options
    faceDetectionWorker.postMessage({
        type: 'init',
        payload: {
            MODELS_URL: MODELS_URL,
            inputSize: currentInputSize,
            scoreThreshold: currentScoreThreshold
        }
    });
}

/**
 * Sends updated settings to the Web Worker.
 */
function updateWorkerSettings() {
    faceDetectionWorker.postMessage({
        type: 'updateSettings',
        payload: {
            inputSize: currentInputSize,
            scoreThreshold: currentScoreThreshold
        }
    });
}

// --- Utility Functions for UI Controls ---

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

/**
 * Enables all main UI controls.
 */
function enableMainControls() {
    captureButton.disabled = false;
    switchCameraButton.disabled = false;
    toggleDetectionButton.disabled = false;
    countrySelect.disabled = false;
    resolutionSelect.disabled = false;
    enableDevControls();
    applyDevSettingsButton.disabled = false;
}

/**
 * Disables all main UI controls.
 */
function disableAllControls() {
    captureButton.disabled = true;
    switchCameraButton.disabled = true;
    toggleDetectionButton.disabled = true;
    countrySelect.disabled = true;
    resolutionSelect.disabled = true;
    disableDevControls();
    applyDevSettingsButton.disabled = true;
}

/**
 * Enables developer settings controls.
 */
function enableDevControls() {
    inputSizeSlider.disabled = false;
    inputSizeNumber.disabled = false;
    scoreThresholdSlider.disabled = false;
    scoreThresholdNumber.disabled = false;
    skipFramesSlider.disabled = false;
    skipFramesNumber.disabled = false;
    heightAboveHeadSlider.disabled = false;
    heightAboveHeadNumber.disabled = false;
    faceScaleSlider.disabled = false;
    faceScaleNumber.disabled = false;
    viewfinderResWidthSlider.disabled = false;
    viewfinderResWidthNumber.disabled = false;
    viewfinderAspectRatioSlider.disabled = false;
    viewfinderAspectRatioNumber.disabled = false;
}

/**
 * Disables developer settings controls.
 */
function disableDevControls() {
    inputSizeSlider.disabled = true;
    inputSizeNumber.disabled = true;
    scoreThresholdSlider.disabled = true;
    scoreThresholdNumber.disabled = true;
    skipFramesSlider.disabled = true;
    skipFramesNumber.disabled = true;
    heightAboveHeadSlider.disabled = true;
    heightAboveHeadNumber.disabled = true;
    faceScaleSlider.disabled = true;
    faceScaleNumber.disabled = true;
    viewfinderResWidthSlider.disabled = true;
    viewfinderResWidthNumber.disabled = true;
    viewfinderAspectRatioSlider.disabled = true;
    viewfinderAspectRatioNumber.disabled = true;
}

// --- Camera Management ---

/**
 * Initializes the camera stream based on the specified facingMode and viewfinder settings.
 * Stops any existing stream before starting a new one.
 * @param {string} facingMode - 'user' for front camera, 'environment' for rear camera.
 * @param {number} targetWidth - Desired video stream width.
 * @param {number} targetAspectRatio - Desired aspect ratio (width/height) for the video container.
 */
async function initCamera(facingMode, targetWidth, targetAspectRatio) {
    if (video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
    }

    disableAllControls();
    overlayBox.style.display = 'none';
    hideStaticGuides();
    updateComplianceMessage('');
    loadingMessage.style.display = 'block';
    loadingMessage.textContent = `Accessing ${facingMode === 'user' ? 'front' : 'rear'} camera...`;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: facingMode,
                width: { ideal: targetWidth },
                height: { ideal: Math.round(targetWidth / (16/9)) } // Try to request 16:9 for source, then fit to container
            }
        });
        video.srcObject = stream;
        currentFacingMode = facingMode; // Update the global facing mode variable

        // Set video container's aspect ratio based on dev settings for visual guidance
        video.onloadedmetadata = () => {
            // Apply the actual container dimensions to guide the user visually
            // Set max-width and aspect-ratio for video container
            const container = document.getElementById('video-container');
            container.style.maxWidth = '600px'; // Keep max-width constraint
            container.style.aspectRatio = targetAspectRatio.toFixed(2); // Apply selected aspect ratio

            video.play();
            loadingMessage.textContent = "Loading AI models...";
            // Initialize worker and load models (if not already done)
            if (!faceDetectionWorker) {
                initializeWorker();
            } else if (!modelsLoadedInWorker) {
                // Worker exists but models not loaded yet, wait for modelsLoaded message
                faceDetectionWorker.postMessage({
                    type: 'init', // Re-init if models not loaded
                    payload: {
                        MODELS_URL: MODELS_URL,
                        inputSize: currentInputSize,
                        scoreThreshold: currentScoreThreshold
                    }
                });
            } else {
                // Models already loaded in worker, just update settings if changed
                updateWorkerSettings();
                enableMainControls();
                startFaceDetectionLoop();
            }
        };
        video.style.transform = (facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)');

    } catch (err) {
        console.error("Error accessing camera: ", err);
        loadingMessage.textContent = "Error: Camera access denied or not available. Please ensure HTTPS and granted permissions.";
        showCustomMessageBox("Camera access denied or not available. Please allow camera access and ensure you are on HTTPS.");
        disableAllControls();
    }
}

// --- Face Detection Loop Control ---

/**
 * Starts the continuous face detection loop using requestAnimationFrame.
 * Sends video frames to the Web Worker for processing.
 */
async function startFaceDetectionLoop() {
    if (isDetecting && !animationFrameId && modelsLoadedInWorker) {
        let lastVideoTime = -1;
        let frameCounter = 0;

        async function detectFacesLoop() {
            if (!video.paused && video.currentTime !== lastVideoTime && isDetecting) {
                lastVideoTime = video.currentTime;
                frameCounter++;

                if (frameCounter % (currentFramesToSkip + 1) === 0) {
                    // Create a temporary canvas to get ImageData from the video frame
                    // This canvas must be sized to match the video's actual resolution for capture quality
                    // but we will send ImageData to the worker at a scaled resolution for detection performance.
                    hiddenCanvas.width = video.videoWidth;
                    hiddenCanvas.height = video.videoHeight;
                    context.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

                    // For worker processing, scale down the image data
                    const scaledWidth = Math.round(video.videoWidth / 4); // Example: quarter resolution for detection
                    const scaledHeight = Math.round(video.videoHeight / 4);
                    const tempDetectionCanvas = document.createElement('canvas');
                    tempDetectionCanvas.width = scaledWidth;
                    tempDetectionCanvas.height = scaledHeight;
                    const tempCtx = tempDetectionCanvas.getContext('2d');
                    tempCtx.drawImage(video, 0, 0, scaledWidth, scaledHeight);
                    const imageData = tempCtx.getImageData(0, 0, scaledWidth, scaledHeight);

                    // Send the scaled ImageData to the worker
                    faceDetectionWorker.postMessage({
                        type: 'processFrame',
                        payload: {
                            imageData: imageData, // Transferable object
                            width: scaledWidth,
                            height: scaledHeight
                        }
                    }, [imageData.data.buffer]); // Transfer the array buffer for performance
                }
            }

            if (isDetecting) {
                animationFrameId = requestAnimationFrame(detectFacesLoop);
            } else {
                animationFrameId = null;
                overlayBox.style.display = 'none';
                hideStaticGuides();
                updateComplianceMessage('');
            }
        }
        animationFrameId = requestAnimationFrame(detectFacesLoop);
        toggleDetectionButton.textContent = 'Pause Detector';
    } else if (!modelsLoadedInWorker) {
        console.log("Cannot start detection: Models not loaded in worker yet.");
        updateComplianceMessage('Waiting for AI models...', 'yellow');
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
        hideStaticGuides();
        updateComplianceMessage('');
        toggleDetectionButton.textContent = 'Start Detector';
    }
}

/**
 * Handles face detection results received from the Web Worker.
 * Updates the overlay box and compliance messages.
 * @param {object} detectionResults - Object containing box, score, and landmarks.
 */
function handleDetectionResults(detectionResults) {
    const faceBox = detectionResults.box;
    const landmarks = detectionResults.landmarks;

    // IMPORTANT: detectionResults.box and landmarks are relative to the SCALED image
    // sent to the worker. We need to scale them back to the video element's display size.
    const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
    const detectionScaleFactorX = displaySize.width / (detectionResults.width || video.videoWidth / 4); // Adjust based on how you scaled for worker
    const detectionScaleFactorY = displaySize.height / (detectionResults.height || video.videoHeight / 4);

    const scaledFaceBox = {
        x: faceBox.x * detectionScaleFactorX,
        y: faceBox.y * detectionScaleFactorY,
        width: faceBox.width * detectionScaleFactorX,
        height: faceBox.height * detectionScaleFactorY
    };
    const scaledLandmarks = landmarks.map(p => ({
        x: p.x * detectionScaleFactorX,
        y: p.y * detectionScaleFactorY
    }));


    // Calculate target passport photo dimensions for the overlay based on current country specs
    // This overlay represents the *ideal* final photo crop area.
    const targetPassportPhotoHeightPx = displaySize.height; // Use full video height for simplicity of overlay
    const targetPassportPhotoWidthPx = targetPassportPhotoHeightPx * currentSpecs.aspectRatio;

    // Calculate ideal face dimensions and position within this target overlay
    const idealFaceHeightInOverlay = targetPassportPhotoHeightPx * currentFaceScale;
    const idealFaceOffsetTopInOverlay = targetPassportPhotoHeightPx * currentHeightAboveHead;

    // Calculate the scale factor needed to fit the DETECTED face to the IDEAL face size within the overlay
    const scaleFactorToFitFace = idealFaceHeightInOverlay / scaledFaceBox.height;

    // Calculate the center of the detected face (on display)
    const detectedFaceCenterX = scaledFaceBox.x + scaledFaceBox.width / 2;
    const detectedFaceCenterY = scaledFaceBox.y + scaledFaceBox.height / 2;

    // Calculate the ideal top-left corner of the OVERLAY box
    // based on where the detected face needs to be relative to the overlay's ideal position.
    // The detected face's top (scaledFaceBox.y) should align with (overlayTop + idealFaceOffsetTopInOverlay / scaleFactorToFitFace)
    // No, this is wrong. The overlay itself needs to be placed so that the detected face
    // falls into its ideal spot within the overlay.
    // So, overlay Y = scaledFaceBox.y - (idealFaceOffsetTopInOverlay / scaleFactorToFitFace) is correct logic for original image.
    // For display, it's simpler:
    // Ideal Y for overlay: Place overlay's top such that `idealFaceOffsetTopInOverlay` aligns with detected face's top
    const overlayTargetY = scaledFaceBox.y - idealFaceOffsetTopInOverlay;
    // Ideal X for overlay: Center overlay around detected face's center
    const overlayTargetX = detectedFaceCenterX - (targetPassportPhotoWidthPx / 2);

    // Apply boundary checks to keep overlay within video frame
    let finalOverlayX = Math.max(0, Math.min(overlayTargetX, displaySize.width - targetPassportPhotoWidthPx));
    let finalOverlayY = Math.max(0, Math.min(overlayTargetY, displaySize.height - targetPassportPhotoHeightPx));

    // Update the overlay box's position and size
    overlayBox.style.left = `${finalOverlayX}px`;
    overlayBox.style.top = `${finalOverlayY}px`;
    overlayBox.style.width = `${targetPassportPhotoWidthPx}px`;
    overlayBox.style.height = `${targetPassportPhotoHeightPx}px`;
    overlayBox.style.display = 'block'; // Show the overlay


    // --- Compliance Checks and Color/Message Updates ---

    // 1. Center Deviation (Horizontal)
    const overlayCenterX = finalOverlayX + targetPassportPhotoWidthPx / 2;
    const horizontalDeviation = Math.abs(detectedFaceCenterX - overlayCenterX);
    const maxAllowedHorizontalDeviation = targetPassportPhotoWidthPx * COMPLIANCE_THRESHOLDS.centerDeviationRatio;

    // 2. Center Deviation (Vertical - based on head space)
    const idealHeadTopYInOverlay = finalOverlayY + idealFaceOffsetTopInOverlay;
    const verticalDeviation = Math.abs(scaledFaceBox.y - idealHeadTopYInOverlay);
    const maxAllowedVerticalDeviation = targetPassportPhotoHeightPx * COMPLIANCE_THRESHOLDS.centerDeviationRatio;


    // 3. Face Scale (Height)
    // How close is the detected face height (scaledFaceBox.height) to the idealFaceHeightInOverlay?
    const faceScaleDeviation = Math.abs(scaledFaceBox.height - idealFaceHeightInOverlay);
    const maxAllowedScaleDeviation = idealFaceHeightInOverlay * COMPLIANCE_THRESHOLDS.scaleDeviationRatio;

    // 4. Head Pose (Yaw and Pitch from landmarks)
    const noseTip = scaledLandmarks[30]; // Index for nose tip
    const leftEye = scaledLandmarks[36]; // Left eye corner
    const rightEye = scaledLandmarks[45]; // Right eye corner

    // Basic head yaw estimation (left/right rotation)
    // If head is straight, nose tip should be horizontally centered between eye corners
    const eyeMidPointX = (leftEye.x + rightEye.x) / 2;
    const yawDeviation = Math.abs(noseTip.x - eyeMidPointX);
    const maxAllowedYawDeviation = scaledFaceBox.width * 0.05; // e.g., 5% of face width

    // Basic head pitch estimation (up/down tilt) - simplified
    // If head is straight, nose tip should be vertically aligned with a certain point on face
    const pitchDeviation = Math.abs(noseTip.y - (scaledFaceBox.y + scaledFaceBox.height * 0.4)); // Example: nose ~40% down face height
    const maxAllowedPitchDeviation = scaledFaceBox.height * 0.05;


    let status = 'green';
    let message = 'Perfect!';

    if (horizontalDeviation > maxAllowedHorizontalDeviation ||
        verticalDeviation > maxAllowedVerticalDeviation ||
        faceScaleDeviation > maxAllowedScaleDeviation ||
        yawDeviation > maxAllowedYawDeviation ||
        pitchDeviation > maxAllowedPitchDeviation) {

        status = 'yellow';
        message = 'Adjust position: ';
        if (horizontalDeviation > maxAllowedHorizontalDeviation) {
            message += detectedFaceCenterX < overlayCenterX ? 'Move right. ' : 'Move left. ';
        }
        if (verticalDeviation > maxAllowedVerticalDeviation) {
            message += scaledFaceBox.y < idealHeadTopYInOverlay ? 'Move up. ' : 'Move down. ';
        }
        if (faceScaleDeviation > maxAllowedScaleDeviation) {
            message += scaledFaceBox.height < idealFaceHeightInOverlay ? 'Move closer. ' : 'Move further. ';
        }
        if (yawDeviation > maxAllowedYawDeviation) {
            message += noseTip.x < eyeMidPointX ? 'Turn right slightly. ' : 'Turn left slightly. ';
        }
        if (pitchDeviation > maxAllowedPitchDeviation) {
            message += noseTip.y < (scaledFaceBox.y + scaledFaceBox.height * 0.4) ? 'Tilt head up slightly. ' : 'Tilt head down slightly. ';
        }

        // If deviations are even larger (e.g., 2.5 times yellow threshold) then it's red
        if (horizontalDeviation > maxAllowedHorizontalDeviation * COMPLIANCE_THRESHOLDS.yellowThresholdMultiplier ||
            verticalDeviation > maxAllowedVerticalDeviation * COMPLIANCE_THRESHOLDS.yellowThresholdMultiplier ||
            faceScaleDeviation > maxAllowedScaleDeviation * COMPLIANCE_THRESHOLDS.yellowThresholdMultiplier ||
            yawDeviation > maxAllowedYawDeviation * COMPLIANCE_THRESHOLDS.yellowThresholdMultiplier ||
            pitchDeviation > maxAllowedPitchDeviation * COMPLIANCE_THRESHOLDS.yellowThresholdMultiplier) {
            status = 'red';
            message = 'Major adjustment needed! ' + message;
        }
    }

    // Apply color to overlay box
    overlayBox.classList.remove('overlay-box-green', 'overlay-box-yellow', 'overlay-box-red');
    overlayBox.classList.add(`overlay-box-${status}`);

    // Update compliance message
    updateComplianceMessage(message, status);


    // --- Update Static Shoulder Guides ---
    showStaticGuides();
    // Estimate shoulder line positions based on detected face and compliance
    const shoulderOffsetFromFaceBottomRatio = 0.1; // Distance from face bottom to top of shoulder line
    const shoulderLineHeightRatio = 0.05; // Thickness of the shoulder region to guide

    const estimatedShoulderTopY = scaledFaceBox.y + scaledFaceBox.height + (scaledFaceBox.height * shoulderOffsetFromFaceBottomRatio);
    const estimatedShoulderBottomY = estimatedShoulderTopY + (scaledFaceBox.height * shoulderLineHeightRatio);

    shoulderLineTop.style.top = `${estimatedShoulderTopY}px`;
    shoulderLineBottom.style.top = `${estimatedShoulderBottomY}px`;

    // Ensure shoulder lines are visible
    shoulderLineTop.style.display = 'block';
    shoulderLineBottom.style.display = 'block';
}

/**
 * Updates the compliance message displayed on the viewfinder.
 * @param {string} message - The message to display.
 * @param {string} status - 'green', 'yellow', or 'red' for styling.
 */
function updateComplianceMessage(message, status = 'neutral') {
    complianceMessage.textContent = message;
    complianceMessage.classList.remove('compliance-green', 'compliance-yellow', 'compliance-red');
    if (status !== 'neutral') {
        complianceMessage.classList.add(`compliance-${status}`);
    }
    complianceMessage.style.display = message ? 'block' : 'none';
}

/**
 * Shows the static crosshair and shoulder guides.
 */
function showStaticGuides() {
    centerCrosshair.style.display = 'block';
    shoulderLineTop.style.display = 'block';
    shoulderLineBottom.style.display = 'block';
}

/**
 * Hides the static crosshair and shoulder guides.
 */
function hideStaticGuides() {
    centerCrosshair.style.display = 'none';
    shoulderLineTop.style.display = 'none';
    shoulderLineBottom.style.display = 'none';
}


/**
 * Processes an image from a source canvas to create a passport photo.
 * This function encapsulates the core cropping logic, allowing it to be reused
 * for initial capture and for re-processing within the modal.
 * @param {HTMLCanvasElement} sourceCanvas - The canvas containing the original image (should be full res video frame).
 * @param {object} selectedSpecs - The passport specifications to use (e.g., aspect ratio, face scale).
 * @param {object} selectedResolution - The output resolution to aim for.
 * @returns {Promise<string|null>} A promise resolving to the data URL of the cropped image or null if no face is detected.
 */
async function processImageForPassport(sourceCanvas, selectedSpecs, selectedResolution) {
    // Perform face detection on the captured static image
    // Note: This detection happens on the main thread, for accuracy on the captured full-res image.
    // If you want to offload this to worker too, you'd need another message type.
    // For now, it's fine for a single capture event.
    const detections = await faceapi.detectSingleFace(sourceCanvas,
        new faceapi.TinyFaceDetectorOptions({
            inputSize: currentInputSize, // Use current dev setting for capture detection
            scoreThreshold: currentScoreThreshold
        })
    ).withFaceLandmarks();

    if (detections) {
        const faceBox = detections.box;
        const landmarks = detections.landmarks; // For potential future use (e.g. detailed pose for capture)

        // Determine final passport photo dimensions based on selected resolution AND country aspect ratio
        let finalPassportWidth = selectedResolution.baseWidth;
        let finalPassportHeight = selectedResolution.baseHeight;

        // Adjust width/height to match the country's aspect ratio based on the largest dimension
        if (selectedSpecs.aspectRatio > 1) { // Wider than tall
            finalPassportHeight = finalPassportWidth / selectedSpecs.aspectRatio;
        } else { // Taller than wide or square
            finalPassportWidth = finalPassportHeight * selectedSpecs.aspectRatio;
        }

        // Use the effective developer settings for the actual crop
        const effectiveFaceScaleHeight = currentFaceScale;
        const effectiveFaceOffsetTopRatio = currentHeightAboveHead;

        // Calculate the target height of the face within the final passport photo
        const targetFaceHeightPx = finalPassportHeight * effectiveFaceScaleHeight;

        // Calculate the scaling factor needed to make the detected face match the target size
        const scaleFactor = targetFaceHeightPx / faceBox.height;

        // Calculate the ideal starting Y-coordinate for the crop on the original image
        const idealCropY = faceBox.y - (finalPassportHeight * effectiveFaceOffsetTopRatio / scaleFactor);

        // Calculate the actual crop dimensions needed on the original image,
        // maintaining the passport photo's aspect ratio
        const cropHeightOnOriginal = finalPassportHeight / scaleFactor;
        const cropWidthOnOriginal = finalPassportWidth / scaleFactor;

        // Center the crop horizontally around the detected face's center
        const faceCenterXOnOriginal = faceBox.x + faceBox.width / 2;
        const idealCropX = faceCenterXOnOriginal - (cropWidthOnOriginal / 2);

        // Apply boundary checks to ensure the crop region doesn't go outside the original image
        let finalCropX = Math.max(0, idealCropX);
        let finalCropY = Math.max(0, idealCropY);
        let finalCropWidth = cropWidthOnOriginal;
        let finalCropHeight = cropHeightOnOriginal;

        // Adjust if crop extends beyond original image width
        if (finalCropX + finalCropWidth > sourceCanvas.width) {
            finalCropX = sourceCanvas.width - finalCropWidth;
            if (finalCropX < 0) finalCropX = 0; // If cropWidth is larger than original image after adjustment
        }
        // Adjust if crop extends beyond original image height
        if (finalCropY + finalCropHeight > sourceCanvas.height) {
            finalCropY = sourceCanvas.height - finalCropHeight;
            if (finalCropY < 0) finalCropY = 0; // If cropHeight is larger than original image after adjustment
        }

        // Create a new canvas to hold the final passport photo
        const passportCanvas = document.createElement('canvas');
        passportCanvas.width = finalPassportWidth;
        passportCanvas.height = finalPassportHeight;
        const passportContext = passportCanvas.getContext('2d');

        // Draw the determined cropped section from the hidden canvas onto the passport canvas,
        // scaling it up or down to the final passport photo dimensions.
        passportContext.drawImage(
            sourceCanvas,
            finalCropX, finalCropY, finalCropWidth, finalCropHeight, // Source rectangle on original image
            0, 0, finalPassportWidth, finalPassportHeight // Destination rectangle on passport photo canvas
        );

        return passportCanvas.toDataURL('image/png');

    } else {
        return null; // No face detected
    }
}


// --- Event Listeners (Main Controls) ---

captureButton.addEventListener('click', async () => {
    if (!modelsLoadedInWorker) {
        showCustomMessageBox("AI Models are still loading. Please wait a moment.");
        return;
    }

    // Draw the current video frame to a hidden canvas at its native resolution
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

    const specsForCapture = {
        aspectRatio: currentSpecs.aspectRatio,
        faceScaleHeight: currentFaceScale,
        faceOffsetTopRatio: currentHeightAboveHead
    };

    const outputImageURL = await processImageForPassport(hiddenCanvas, specsForCapture, currentOutputResolution);

    let modalMessage = "No face detected in the photo!";
    if (outputImageURL) {
        modalMessage = "Your Passport Photo:";
    }

    modalTitle.textContent = modalMessage;
    modalPassportPhoto.src = outputImageURL || '';
    modalPassportPhoto.style.display = outputImageURL ? 'block' : 'none';
    modalCountrySpec.textContent = `Country/Type: ${currentSpecs.name}`; // Removed "Dev Overrides Applied" for cleaner UI
    modalResolutionSpec.textContent = `Output Resolution: ${currentOutputResolution.name}`;

    populateSelect(countrySelectModal, PASSPORT_SPECS, currentSpecs.value);
    populateSelect(resolutionSelectModal, OUTPUT_RESOLUTIONS, currentOutputResolution.value);

    showModal(photoModal);
});

switchCameraButton.addEventListener('click', () => {
    currentFacingMode = (currentFacingMode === 'user' ? 'environment' : 'user');
    stopFaceDetectionLoop();
    initCamera(currentFacingMode, currentViewfinderResWidth, currentViewfinderAspectRatio);
});

toggleDetectionButton.addEventListener('click', () => {
    isDetecting = !isDetecting;
    if (isDetecting) {
        startFaceDetectionLoop();
    } else {
        stopFaceDetectionLoop();
    }
});

countrySelect.addEventListener('change', (event) => {
    currentSpecs = PASSPORT_SPECS[event.target.value];
    console.log(`Passport specs set to: ${currentSpecs.name}`);
    // No immediate detection loop restart here; changes will apply via compliance update or photo capture
});

resolutionSelect.addEventListener('change', (event) => {
    currentOutputResolution = OUTPUT_RESOLUTIONS[event.target.value];
    console.log(`Output resolution set to: ${currentOutputResolution.name}`);
});

// --- Event Listeners (Photo Modal Controls) ---

allCloseXButtons.forEach(button => {
    button.addEventListener('click', (event) => {
        const modalToHide = event.target.closest('.modal-overlay');
        if (modalToHide) {
            hideModal(modalToHide);
        }
    });
});


reprocessButton.addEventListener('click', async () => {
    const selectedModalCountryValue = countrySelectModal.value;
    const selectedModalResolutionValue = resolutionSelectModal.value;

    const newSpecs = PASSPORT_SPECS[selectedModalCountryValue];
    const newResolution = OUTPUT_RESOLUTIONS[selectedModalResolutionValue];

    if (hiddenCanvas.width === 0 || hiddenCanvas.height === 0) {
        console.error("Original image data not found in hiddenCanvas for re-processing.");
        showCustomMessageBox("Original image not found for re-processing. Please capture a new photo.");
        return;
    }

    const specsForReprocess = {
        aspectRatio: newSpecs.aspectRatio,
        faceScaleHeight: currentFaceScale,
        faceOffsetTopRatio: currentHeightAboveHead
    };

    const outputImageURL = await processImageForPassport(hiddenCanvas, specsForReprocess, newResolution);

    if (outputImageURL) {
        modalPassportPhoto.src = outputImageURL;
        modalTitle.textContent = "Your Passport Photo (Re-processed):";
        modalPassportPhoto.style.display = 'block';
    } else {
        modalTitle.textContent = "No face detected in the re-processed photo!";
        modalPassportPhoto.style.display = 'none';
    }
    modalCountrySpec.textContent = `Country/Type: ${newSpecs.name}`; // Removed "Dev Overrides Applied"
    modalResolutionSpec.textContent = `Output Resolution: ${newResolution.name}`;
});

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
        showCustomMessageBox("No photo to download! Please capture or re-process a photo first.");
    }
});

// --- Event Listeners (Inline Developer Settings Controls - TEMPORARY VALUES) ---

inputSizeSlider.addEventListener('input', (event) => {
    tempInputSize = parseInt(event.target.value);
    inputSizeNumber.value = tempInputSize;
});
inputSizeNumber.addEventListener('change', (event) => {
    let val = parseInt(event.target.value);
    const min = parseInt(inputSizeNumber.min);
    const max = parseInt(inputSizeNumber.max);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val / 32) * 32;
    event.target.value = val;
    tempInputSize = val;
    inputSizeSlider.value = val;
});

scoreThresholdSlider.addEventListener('input', (event) => {
    tempScoreThreshold = parseFloat(event.target.value);
    scoreThresholdNumber.value = tempScoreThreshold.toFixed(2);
});
scoreThresholdNumber.addEventListener('change', (event) => {
    let val = parseFloat(event.target.value);
    const min = parseFloat(scoreThresholdNumber.min);
    const max = parseFloat(scoreThresholdNumber.max);
    const step = parseFloat(scoreThresholdNumber.step);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val * (1 / step)) / (1 / step);
    event.target.value = val.toFixed(2);
    tempScoreThreshold = val;
    scoreThresholdSlider.value = val;
});

skipFramesSlider.addEventListener('input', (event) => {
    tempFramesToSkip = parseInt(event.target.value);
    skipFramesNumber.value = tempFramesToSkip;
});
skipFramesNumber.addEventListener('change', (event) => {
    let val = parseInt(event.target.value);
    const min = parseInt(skipFramesNumber.min);
    const max = parseInt(skipFramesNumber.max);
    val = Math.max(min, Math.min(max, val));
    event.target.value = val;
    tempFramesToSkip = val;
    skipFramesSlider.value = val;
});

heightAboveHeadSlider.addEventListener('input', (event) => {
    tempHeightAboveHead = parseFloat(event.target.value);
    heightAboveHeadNumber.value = tempHeightAboveHead.toFixed(2);
});
heightAboveHeadNumber.addEventListener('change', (event) => {
    let val = parseFloat(event.target.value);
    const min = parseFloat(heightAboveHeadNumber.min);
    const max = parseFloat(heightAboveHeadNumber.max);
    const step = parseFloat(heightAboveHeadNumber.step);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val * (1 / step)) / (1 / step);
    event.target.value = val.toFixed(2);
    tempHeightAboveHead = val;
    heightAboveHeadSlider.value = val;
});

faceScaleSlider.addEventListener('input', (event) => {
    tempFaceScale = parseFloat(event.target.value);
    faceScaleNumber.value = tempFaceScale.toFixed(2);
});
faceScaleNumber.addEventListener('change', (event) => {
    let val = parseFloat(event.target.value);
    const min = parseFloat(faceScaleNumber.min);
    const max = parseFloat(faceScaleNumber.max);
    const step = parseFloat(faceScaleNumber.step);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val * (1 / step)) / (1 / step);
    event.target.value = val.toFixed(2);
    tempFaceScale = val;
    faceScaleSlider.value = val;
});

// NEW: Viewfinder Resolution/Aspect Ratio Temp Listeners
viewfinderResWidthSlider.addEventListener('input', (event) => {
    tempViewfinderResWidth = parseInt(event.target.value);
    viewfinderResWidthNumber.value = tempViewfinderResWidth;
});
viewfinderResWidthNumber.addEventListener('change', (event) => {
    let val = parseInt(event.target.value);
    const min = parseInt(viewfinderResWidthNumber.min);
    const max = parseInt(viewfinderResWidthNumber.max);
    val = Math.max(min, Math.min(max, val));
    event.target.value = val;
    tempViewfinderResWidth = val;
    viewfinderResWidthSlider.value = val;
});

viewfinderAspectRatioSlider.addEventListener('input', (event) => {
    tempViewfinderAspectRatio = parseFloat(event.target.value);
    viewfinderAspectRatioNumber.value = tempViewfinderAspectRatio.toFixed(2);
});
viewfinderAspectRatioNumber.addEventListener('change', (event) => {
    let val = parseFloat(event.target.value);
    const min = parseFloat(viewfinderAspectRatioNumber.min);
    const max = parseFloat(viewfinderAspectRatioNumber.max);
    const step = parseFloat(viewfinderAspectRatioNumber.step);
    val = Math.max(min, Math.min(max, val));
    val = Math.round(val * (1 / step)) / (1 / step);
    event.target.value = val.toFixed(2);
    tempViewfinderAspectRatio = val;
    viewfinderAspectRatioSlider.value = val;
});


/**
 * Event listener for the new "Apply Developer Settings" button.
 * Applies all temporary developer settings and re-initializes camera/detection.
 */
applyDevSettingsButton.addEventListener('click', () => {
    // Update active settings from temporary values
    currentInputSize = tempInputSize;
    currentScoreThreshold = tempScoreThreshold;
    currentFramesToSkip = tempFramesToSkip;
    currentHeightAboveHead = tempHeightAboveHead;
    currentFaceScale = tempFaceScale;
    const resolutionChanged = currentViewfinderResWidth !== tempViewfinderResWidth || currentViewfinderAspectRatio !== tempViewfinderAspectRatio;
    currentViewfinderResWidth = tempViewfinderResWidth;
    currentViewfinderAspectRatio = tempViewfinderAspectRatio;

    console.log("Applied Developer Settings:", {
        currentInputSize, currentScoreThreshold, currentFramesToSkip,
        currentHeightAboveHead, currentFaceScale, currentViewfinderResWidth,
        currentViewfinderAspectRatio
    });

    // Stop current detection loop and re-init worker settings
    stopFaceDetectionLoop();
    updateWorkerSettings(); // Update worker with new AI settings

    // Re-initialize camera if viewfinder settings changed
    if (resolutionChanged) {
        initCamera(currentFacingMode, currentViewfinderResWidth, currentViewfinderAspectRatio);
    } else {
        // If only AI settings changed, just restart detection
        startFaceDetectionLoop();
    }
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

// Start the camera and worker initialization process when the window has fully loaded
window.addEventListener('load', () => {
    // Initial population of main dropdowns
    populateSelect(countrySelect, PASSPORT_SPECS, 'standard');
    populateSelect(resolutionSelect, OUTPUT_RESOLUTIONS, 'high-res');

    // Initialize camera with default/current dev settings
    initCamera(currentFacingMode, currentViewfinderResWidth, currentViewfinderAspectRatio);
});
