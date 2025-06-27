// js/faceDetectionWorker.js
// This script runs in a Web Worker, allowing face detection to occur on a separate thread
// from the main UI thread, improving responsiveness.

// IMPORTANT: face-api.js must be loaded in the worker scope.
// The path here is relative to the worker script's location.
// Assuming faceDetectionWorker.js is in 'js/' and face-api.js is in 'face-api.js/dist/'
importScripts('../face-api.js/dist/face-api.min.js');

let tinyFaceDetectorOptions;
let MODELS_URL; // Will be set by a message from the main thread

// Listen for messages from the main thread
self.onmessage = async (event) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'init':
            // Initialize the worker with necessary configurations
            MODELS_URL = payload.MODELS_URL;
            tinyFaceDetectorOptions = new faceapi.TinyFaceDetectorOptions({
                inputSize: payload.inputSize,
                scoreThreshold: payload.scoreThreshold
            });
            console.log('Worker initialized:', payload);
            await loadModels(); // Load models when worker is initialized
            break;

        case 'updateSettings':
            // Update detector settings without re-loading models
            tinyFaceDetectorOptions = new faceapi.TinyFaceDetectorOptions({
                inputSize: payload.inputSize,
                scoreThreshold: payload.scoreThreshold
            });
            console.log('Worker settings updated:', payload);
            break;

        case 'processFrame':
            // Process a video frame for face detection
            if (!tinyFaceDetectorOptions) {
                console.warn('Worker not initialized, cannot process frame.');
                return;
            }
            if (!faceapi.nets.tinyFaceDetector.isLoaded) {
                 // console.warn('Models not loaded in worker yet. Skipping frame.');
                 // Don't warn every frame, just skip if not ready.
                 self.postMessage({ type: 'modelsNotReady' });
                 return;
            }

            // Create a temporary canvas in the worker to draw the ImageData
            // This is necessary because ImageData cannot be directly used by face-api.js
            // if it expects a DOM element (like video/canvas).
            // However, face-api.js can process ImageData directly if given the correct type.
            // For older face-api.js versions or complex setups, an OffscreenCanvas might be needed,
            // but for simple detection, ImageData is often enough directly if the API supports it.
            // Let's create an OffscreenCanvas for better compatibility with face-api.js's internal
            // image processing methods, as it mimics a DOM Canvas.
            let offscreenCanvas;
            try {
                // Try creating OffscreenCanvas if available
                offscreenCanvas = new OffscreenCanvas(payload.width, payload.height);
            } catch (e) {
                // Fallback for browsers not supporting OffscreenCanvas in workers for this purpose
                // In this case, faceapi.js should be able to process ImageData directly or
                // the main thread would need to send a Blob/ImageBitmap
                console.error("OffscreenCanvas not supported or failed to create in worker. Fallback to direct ImageData processing.", e);
                // For direct ImageData processing by face-api.js, ensure payload.imageData is valid.
                // It means faceapi.detectSingleFace(imageData, options) is what's expected.
                // However, face-api.js generally expects an HTMLVideoElement, HTMLCanvasElement, or HTMLImageElement.
                // So, drawing ImageData to an OffscreenCanvas is the best approach for worker compatibility.
                self.postMessage({ type: 'error', message: 'OffscreenCanvas not supported, cannot process frames in worker.' });
                return;
            }

            const ctx = offscreenCanvas.getContext('2d');
            const imageData = new ImageData(new Uint8ClampedArray(payload.imageData.data), payload.imageData.width, payload.imageData.height);
            ctx.putImageData(imageData, 0, 0);

            // Perform face detection
            const detections = await faceapi.detectSingleFace(offscreenCanvas, tinyFaceDetectorOptions)
                                            .withFaceLandmarks(); // Also get landmarks for pose estimation

            if (detections) {
                // Post the detection results back to the main thread
                // Detections object needs to be serializable, so convert to plain JS object or specific properties
                const serializableDetections = {
                    box: detections.box,
                    score: detections.score,
                    landmarks: detections.landmarks.positions // Array of Point objects
                };
                self.postMessage({ type: 'detectionResults', payload: serializableDetections });
            } else {
                self.postMessage({ type: 'noFaceDetected' });
            }
            break;

        default:
            console.warn('Unknown message type:', type);
    }
};

/**
 * Loads the face-api.js models inside the worker.
 */
async function loadModels() {
    try {
        if (!faceapi.nets.tinyFaceDetector.isLoaded) {
            await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
            console.log("Worker: TinyFace Detector model loaded.");
            self.postMessage({ type: 'modelsLoaded' });
        } else {
            console.log("Worker: Models already loaded.");
            self.postMessage({ type: 'modelsLoaded' });
        }
    } catch (error) {
        console.error("Worker: Error loading face-api.js models:", error);
        self.postMessage({ type: 'error', message: 'Failed to load AI models in worker.' });
    }
}

// Initial model load attempt (can be triggered by main thread's init message)
// loadModels();
