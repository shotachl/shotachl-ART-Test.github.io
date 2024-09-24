(async function() {
  const isArSessionSupported = navigator.xr && navigator.xr.isSessionSupported && await navigator.xr.isSessionSupported("immersive-ar");
  if (isArSessionSupported) {
    document.getElementById("enter-ar").addEventListener("click", window.app.activateXR)
  } else {
    onNoXRDevice();
  }
})();

let clicks = 0;

/**
 * Container class to manage connecting to the WebXR Device API
 * and handle rendering on every frame.
 */
class App {
  setupThreeJs() {
    // To help with working with 3D on the web, we'll use three.js.
    // Set up the WebGLRenderer, which handles rendering to our session's base layer.

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      preserveDrawingBuffer: true,
      canvas: this.canvas,
      context: this.gl
    });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Initialize our demo scene.
    this.scene = DemoUtils.createLitScene();
    this.reticle = new Reticle();
    this.scene.add(this.reticle);
    this.touchX;
    this.lastTouchX;

    // We'll update the camera matrices directly from API, so
    // disable matrix auto updates so three.js doesn't attempt
    // to handle the matrices independently.
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;

    document.addEventListener('touchstart', this.onTouchStart);
    document.addEventListener('touchmove', this.onTouchMove);
    document.addEventListener('touchend', this.onTouchEnd);
  }

  

  onTouchStart = (event) => {
    if (event.touches.length === 2) {
        this.touchStartDistance = null;
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        this.touchStartDistance = Math.sqrt(dx * dx + dy * dy);
    }
};

 onTouchMove = (event) => {
    const touch = event.changedTouches[0];

    const currentTouchX = touch.clientX;
    const currentTouchY = touch.clientY;

    const deltaX = currentTouchX - (this.touchX || currentTouchX);
    const deltaY = currentTouchY - (this.touchY || currentTouchY);

    this.scene.children[4].rotation.y += deltaX * 0.01;
    this.scene.children[4].rotation.x += deltaY * 0.01;

    // Update debug info if needed
    // document.getElementById("test2").innerHTML = `DeltaX: ${deltaX}, DeltaY: ${deltaY}`;

    const mouseEvent = new MouseEvent('mousemove', {
      clientX: currentTouchX,
      clientY: currentTouchY
    });

    this.renderer.domElement.dispatchEvent(mouseEvent);
    
    if (event.touches.length === 2 && this.touchStartDistance) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const touchDistance = Math.sqrt(dx * dx + dy * dy);
      
      const scaleFactor = touchDistance / this.touchStartDistance;

      const object = this.scene.children[4];
      object.scale.set(object.scale.x * scaleFactor, object.scale.y * scaleFactor, object.scale.z * scaleFactor);

      this.touchStartDistance = touchDistance;
    }

    this.touchX = currentTouchX;
    this.touchY = currentTouchY;
  }

  onTouchEnd = (event) => {
    if (event.touches.length < 2) {
      this.touchStartDistance = null;
    }
    this.touchX = null;
    this.touchY = null;
  }

  /**
   * Run when the Start AR button is pressed.
   */
  activateXR = async () => {
    try {
      // Initialize a WebXR session using "immersive-ar".
      this.xrSession = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.body }
      });

      // Create the canvas that will contain our camera's background and our virtual scene.
      this.createXRCanvas();

      // With everything set up, start the app.
      await this.onSessionStarted();
    } catch (e) {
      console.log(e);
      onNoXRDevice();
    }
  }

  /**
   * Add a canvas element and initialize a WebGL context that is compatible with WebXR.
   */
  createXRCanvas() {
    this.canvas = document.createElement("canvas");
    document.body.appendChild(this.canvas);
    this.gl = this.canvas.getContext("webgl", {xrCompatible: true});

    this.xrSession.updateRenderState({
      baseLayer: new XRWebGLLayer(this.xrSession, this.gl)
    });
  }

  /**
   * Called when the XRSession has begun. Here we set up our three.js
   * renderer, scene, and camera and attach our XRWebGLLayer to the
   * XRSession and kick off the render loop.
   */
  onSessionStarted = async () => {
    // Add the `ar` class to our body, which will hide our 2D components
    document.body.classList.add('ar');

    // To help with working with 3D on the web, we'll use three.js.
    this.setupThreeJs();

    // Setup an XRReferenceSpace using the "local" coordinate system.
    this.localReferenceSpace = await this.xrSession.requestReferenceSpace('local');

    // Create another XRReferenceSpace that has the viewer as the origin.
    this.viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    // Perform hit testing using the viewer as origin.
    this.hitTestSource = await this.xrSession.requestHitTestSource({ space: this.viewerSpace });

    // Start a rendering loop using this.onXRFrame.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    this.xrSession.addEventListener("select", this.onSelect);

  }

  /** Place a sunflower when the screen is tapped. */
  onSelect = () => {
    if (window.sunflower && this.reticle.visible == true) {
      const clone = window.sunflower.clone();
      clone.position.copy(this.reticle.position);
      clone.scale.set(0.3,0.3,0.3);
      this.scene.add(clone);
      

      const interactionPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ visible: false }) // Invisible plane
      );
      interactionPlane.position.copy(clone.position);
      this.scene.add(interactionPlane);

      const shadowMesh = this.scene.children.find(c => c.name === 'shadowMesh');
      shadowMesh.position.y = clone.position.y;
      
      clicks++;
    }
  }

  /**
   * Called on the XRSession's requestAnimationFrame.
   * Called with the time and XRPresentationFrame.
   */
  onXRFrame = (time, frame) => {
    // Queue up the next draw request.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Bind the graphics framebuffer to the baseLayer's framebuffer.
    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer)
    this.renderer.setFramebuffer(framebuffer);

    // Retrieve the pose of the device.
    // XRFrame.getViewerPose can return null while the session attempts to establish tracking.
    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      // In mobile AR, we only have one view.
      const view = pose.views[0];

      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height)

      // Use the view's transform matrix and projection matrix to configure the THREE.camera.
      this.camera.matrix.fromArray(view.transform.matrix)
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      // Conduct hit test.
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);

      // If we have results, consider the environment stabilized.

      if (hitTestResults.length > 0) {
        const hitPose = hitTestResults[0].getPose(this.localReferenceSpace);

        if (!this.stabilized && hitTestResults.length > 0) {
          this.stabilized = true;
          document.body.classList.add('stabilized');
        }

        // Update the reticle position
        if(clicks < 1){
          this.reticle.visible = true;
        }else if(clicks >= 1){
          this.reticle.visible = false;
        }
        
        this.reticle.position.set(hitPose.transform.position.x, hitPose.transform.position.y, hitPose.transform.position.z);
        this.reticle.updateMatrixWorld(true);
      }

      // Render the scene with THREE.WebGLRenderer.
      this.renderer.render(this.scene, this.camera);
    } 
  }
};

window.app = new App();
