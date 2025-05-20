import * as THREE from 'https://cdn.skypack.dev/three@0.152.2';

let scene, camera, renderer, session, glBinding;
let hasLocalized = false;

const startButton = document.getElementById('startButton');

startButton.addEventListener('click', async () => {
    if (!navigator.xr) {
        alert("WebXR not supported");
        return;
    }

    session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["local", "camera-access"]
    });

    setupThreeJS(session);
});

function setupThreeJS(xrSession) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();

    renderer.xr.setSession(xrSession);

    const gl = renderer.getContext();
    glBinding = new XRWebGLBinding(xrSession, gl);

    animate();
}

function getCameraIntrinsics(projectionMatrix, viewport) {
    const p = projectionMatrix;
    const fx = (viewport.width / 2) * p[0];
    const fy = (viewport.height / 2) * p[5];
    const u0 = ((1 - p[8]) * viewport.width) / 2 + viewport.x;
    const v0 = ((1 - p[9]) * viewport.height) / 2 + viewport.y;
    return { fx, fy, px: u0, py: v0 };
}

async function captureCameraImage(gl, cameraTexture, width, height) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            resolve(blob);
        }, "image/jpeg");
    });
}

async function queryVPS(intrinsics, imageBlob, mapId, width, height) {
    const formData = new FormData();
    formData.append("fx", intrinsics.fx);
    formData.append("fy", intrinsics.fy);
    formData.append("px", intrinsics.px);
    formData.append("py", intrinsics.py);
    formData.append("width", width);
    formData.append("height", height);
    formData.append("queryImage", imageBlob, "frame.jpg");
    formData.append("mapId", mapId);
    formData.append("isRightHanded", "true");

    // ✅ Add client ID and secret here
    formData.append("client_id", "f67b6749-bf5b-42b5-b8a2-5ec3836503d4");
    formData.append("client_secret", "3fd6c23ddcdcd6d58f3db3e3688c55a2fb587439a3f1d9f66ae90eb85a9df3a9");

    const res = await fetch('https://api.multiset.com/vps/localize', {
        method: 'POST',
        body: formData
    });

    return await res.json();
}


function applyLocalization(position, rotation) {
    const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    cube.position.set(position.x, position.y, position.z);
    cube.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    scene.add(cube);
}

function animate() {
    renderer.setAnimationLoop(async (timestamp, frame) => {
        if (!frame || hasLocalized) {
            renderer.render(scene, camera);
            return;
        }

        const refSpace = renderer.xr.getReferenceSpace();
        const pose = frame.getViewerPose(refSpace);
        if (!pose) return;

        const view = pose.views[0];
        const viewport = renderer.xr.getSession().renderState.baseLayer.getViewport(view);
        const intrinsics = getCameraIntrinsics(view.projectionMatrix, viewport);

        const gl = renderer.getContext();

        const camera = renderer.xr.getCamera(frame);
        const cameraTexture = glBinding.getCameraImage(camera);

        if (!cameraTexture) {
            console.warn("Camera texture not available");
            return;
        }

        const imageBlob = await captureCameraImage(gl, cameraTexture, viewport.width, viewport.height);

        const result = await queryVPS(
            intrinsics,
            imageBlob,
            "MAP_CC3MMTRYKP67", // Replace with your real mapId
            viewport.width,
            viewport.height
        );

        if (result && result.position && result.rotation) {
            applyLocalization(result.position, result.rotation);
            hasLocalized = true;
            console.log("Localization applied.");
        }

        renderer.render(scene, camera);
    });
}
