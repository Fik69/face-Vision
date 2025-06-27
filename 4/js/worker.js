// worker.js
// This script runs in a separate thread and handles face detection and image processing.

// Import face-api.js into the worker scope.
// The MODELS_URL needs to be accessible from the worker's context.
// For simplicity, we assume 'face-api.js/dist/face-api.min.js' and 'face-api.js/weights'
// are relative to the main HTML file where the worker is instantiated.
// The worker cannot directly access the DOM or the main thread's 'faceapi' object.
importScripts('./face-api.js/dist/face-api.min.js');

const MODELS_URL = './face-api.js/weights'; // Path to your face-api models

let isModelsLoaded = false;
let currentInputSize = 224;
let currentScoreThreshold = 0.5;

// face-api.js TinyFaceDetector options (function to allow dynamic updates)
const getTinyFaceDetectorOptions = () => new faceapi.TinyFaceDetectorOptions({
    inputSize: currentInputSize,
    scoreThreshold: currentScoreThreshold
});

/**
 * Loads the necessary face-api.js models.
 * @returns {Promise<void>} A promise that resolves when models are loaded.
 */
async function loadModels() {
    try {
        if (!faceapi.nets.tinyFaceDetector.isLoaded) {
            await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
            console.log("Worker: face-api.js TinyFace Detector model loaded successfully.");
            isModelsLoaded = true;
        } else {
            console.log("Worker: face-api.js models already loaded.");
            isModelsLoaded = true;
        }
        postMessage({ type: 'modelsLoaded' });
    } catch (error) {
        console.error("Worker: Error loading face-api.js models:", error);
        postMessage({ type: 'error', message: 'Failed to load AI models.', details: error.message });
    }
}

/**
 * Processes an image from a source ImageData object to create a passport photo.
 * This function encapsulates the core cropping logic, allowing it to be reused.
 * @param {ImageData} imageData - The ImageData object containing the original image pixels.
 * @param {object} selectedSpecs - The passport specifications to use (e.g., aspect ratio, face scale).
 * @param {object} selectedResolution - The output resolution to aim for.
 * @returns {Promise<string|null>} A promise resolving to the data URL of the cropped image or null if no face is detected.
 */
async function processImageForPassport(imageData, selectedSpecs, selectedResolution) {
    // Create an OffscreenCanvas as the source for face detection within the worker
    const offscreenCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const offscreenContext = offscreenCanvas.getContext('2d');
    offscreenContext.putImageData(imageData, 0, 0);

    // Perform face detection on the captured static image from the OffscreenCanvas
    const detections = await faceapi.detectSingleFace(offscreenCanvas, getTinyFaceDetectorOptions());

    if (detections) {
        const faceBox = detections.box;

        let finalPassportWidth = selectedResolution.baseWidth;
        let finalPassportHeight = selectedResolution.baseHeight;

        if (selectedSpecs.aspectRatio > 1) {
            finalPassportHeight = finalPassportWidth / selectedSpecs.aspectRatio;
        } else {
            finalPassportWidth = finalPassportHeight * selectedSpecs.aspectRatio;
        }

        const effectiveFaceScaleHeight = selectedSpecs.faceScaleHeight;
        const effectiveFaceOffsetTopRatio = selectedSpecs.faceOffsetTopRatio;

        const targetFaceHeightPx = finalPassportHeight * effectiveFaceScaleHeight;
        const scaleFactor = targetFaceHeightPx / faceBox.height;

        const idealCropY = faceBox.y - (finalPassportHeight * effectiveFaceOffsetTopRatio / scaleFactor);

        const cropHeightOnOriginal = finalPassportHeight / scaleFactor;
        const cropWidthOnOriginal = finalPassportWidth / scaleFactor;

        const faceCenterXOnOriginal = faceBox.x + faceBox.width / 2;
        const idealCropX = faceCenterXOnOriginal - (cropWidthOnOriginal / 2);

        let finalCropX = Math.max(0, idealCropX);
        let finalCropY = Math.max(0, idealCropY);
        let finalCropWidth = cropWidthOnOriginal;
        let finalCropHeight = cropHeightOnOriginal;

        if (finalCropX + finalCropWidth > offscreenCanvas.width) {
            finalCropX = offscreenCanvas.width - finalCropWidth;
            if (finalCropX < 0) finalCropX = 0;
        }
        if (finalCropY + finalCropHeight > offscreenCanvas.height) {
            finalCropY = offscreenCanvas.height - finalCropHeight;
            if (finalCropY < 0) finalCropY = 0;
        }

        const passportCanvas = new OffscreenCanvas(finalPassportWidth, finalPassportHeight);
        const passportContext = passportCanvas.getContext('2d');

        passportContext.drawImage(
            offscreenCanvas,
            finalCropX, finalCropY, finalCropWidth, finalCropHeight, // Source rectangle on original image
            0, 0, finalPassportWidth, finalPassportHeight // Destination rectangle on passport photo canvas
        );

        // Convert OffscreenCanvas to Blob, then read as Data URL
        const blob = await passportCanvas.convertToBlob({ type: 'image/png' });
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });

    } else {
        return null; // No face detected
    }
}


// Event listener for messages from the main thread
self.onmessage = async (event) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'loadModels':
            await loadModels();
            break;
        case 'detectFace':
            if (!isModelsLoaded) {
                console.warn("Worker: Models not loaded for detection request.");
                return;
            }
            const { imageData, videoWidth, videoHeight, currentFramesToSkip, displayWidth, displayHeight, currentSpecs, currentHeightAboveHead, currentFaceScale } = payload;

            // Use OffscreenCanvas for detection
            const offscreenCanvas = new OffscreenCanvas(videoWidth, videoHeight);
            const offscreenContext = offscreenCanvas.getContext('2d');
            offscreenContext.putImageData(imageData, 0, 0);

            // Perform detection only on the Nth frame, where N = currentFramesToSkip + 1
            if (payload.frameCounter % (currentFramesToSkip + 1) === 0) {
                const detections = await faceapi.detectSingleFace(offscreenCanvas, getTinyFaceDetectorOptions());

                if (detections) {
                    // Resize the detection results to match the video element's display size (which is on the main thread)
                    const displaySize = { width: displayWidth, height: displayHeight };
                    const resizedDetection = faceapi.resizeResults(detections, displaySize);
                    const faceBox = resizedDetection.box;

                    // Create a temporary specs object that incorporates developer settings for the overlay
                    const tempSpecsForOverlay = {
                        aspectRatio: currentSpecs.aspectRatio,
                        faceScaleHeight: currentFaceScale,
                        faceOffsetTopRatio: currentHeightAboveHead
                    };

                    // Calculate overlay box dimensions based on the *developer settings*
                    const targetFaceHeightPx = displaySize.height * tempSpecsForOverlay.faceScaleHeight;
                    const scaleFactor = targetFaceHeightPx / faceBox.height;

                    const overlayHeight = displaySize.height;
                    const overlayWidth = overlayHeight * tempSpecsForOverlay.aspectRatio;

                    const idealOverlayY = faceBox.y - (overlayHeight * tempSpecsForOverlay.faceOffsetTopRatio);

                    const faceCenterXOnDisplay = faceBox.x + faceBox.width / 2;
                    const idealOverlayX = faceCenterXOnDisplay - (overlayWidth / 2);

                    let finalOverlayX = Math.max(0, idealOverlayX);
                    let finalOverlayY = Math.max(0, idealOverlayY);

                    if (finalOverlayX + overlayWidth > displaySize.width) {
                        finalOverlayX = displaySize.width - overlayWidth;
                        if (finalOverlayX < 0) finalOverlayX = 0;
                    }
                    if (finalOverlayY + overlayHeight > displaySize.height) {
                        finalOverlayY = displaySize.height - overlayHeight;
                        if (finalOverlayY < 0) finalOverlayY = 0;
                    }

                    postMessage({
                        type: 'detectionResult',
                        detection: {
                            x: finalOverlayX,
                            y: finalOverlayY,
                            width: overlayWidth,
                            height: overlayHeight
                        }
                    });
                } else {
                    postMessage({ type: 'detectionResult', detection: null });
                }
            }
            break;
        case 'processImage':
            if (!isModelsLoaded) {
                postMessage({ type: 'error', message: 'Models not loaded for image processing.' });
                return;
            }
            const { imageData: imgData, specs, resolution } = payload;
            const outputImageURL = await processImageForPassport(imgData, specs, resolution);
            postMessage({ type: 'imageProcessed', outputImageURL: outputImageURL });
            break;
        case 'updateDetectorOptions':
            currentInputSize = payload.inputSize;
            currentScoreThreshold = payload.scoreThreshold;
            console.log(`Worker: Detector options updated - Input Size: ${currentInputSize}, Score Threshold: ${currentScoreThreshold}`);
            break;
    }
};
