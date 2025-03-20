import * as THREE from 'three'
import {
  OrbitControls, EffectComposer, RenderPass,
  OutputPass, UnrealBloomPass, ShaderPass,
  TeapotGeometry,
} from 'three/examples/jsm/Addons.js'
import { Pane, BladeApi } from 'tweakpane'
import snoise from './lib/noise/snoise.glsl?raw'
import './style.css'

let scale = 1
function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
if(isMobile()) scale = 0.7

const vas = document.querySelector('canvas') as HTMLCanvasElement
if(!vas) throw new Error('`canvas` not found.')
const scene = new THREE.Scene()
const cam = new THREE.PerspectiveCamera(
  75, vas.clientWidth / vas.clientHeight, 0.001, 100,
)

const pos = isMobile() ? [0, 8, 18] : [0, 1, 14]
cam.position.set.apply(globalThis, pos as [number, number, number])

const blacǩ = new THREE.Color(0x000000)
scene.background = blacǩ

const rend = new THREE.WebGLRenderer({ canvas: vas, antialias: true })
rend.setPixelRatio(window.devicePixelRatio)
rend.setSize(vas.clientWidth * scale, vas.clientHeight * scale, false)
rend.toneMapping = THREE.CineonToneMapping
rend.outputColorSpace = THREE.SRGBColorSpace

const composers = [new EffectComposer(rend), new EffectComposer(rend)]
const renderPass = new RenderPass(scene, cam)
let radius = isMobile() ? 0.1 : 0.25
const unrealBloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerHeight * scale, window.innerWidth * scale),
  0.5,
  radius,
  0.2,
)
const outPass = new OutputPass()
const shaderPass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null },
    uBloomTexture: { value: composers[0].renderTarget2.texture },
    uStrength: { value: isMobile() ? 6.00 : 8.00 },
  },

  vertexShader: `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D uBloomTexture;
    uniform float uStrength;
    varying vec2 vUv;
    void main(){
      vec4 baseEffect = texture2D(tDiffuse,vUv);
      vec4 bloomEffect = texture2D(uBloomTexture,vUv);
      gl_FragColor =baseEffect + bloomEffect * uStrength;
    }
  `,
}))

composers[0].addPass(renderPass)
composers[0].addPass(unrealBloomPass)
composers[0].renderToScreen = false

composers[1].addPass(renderPass)
composers[1].addPass(shaderPass)
composers[1].addPass(outPass)


const controls = new OrbitControls(cam, vas)
const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256)
const cubeCamera = new THREE.CubeCamera(0.1, 500, cubeRenderTarget)
let cubeTexture: THREE.CubeTexture


function generateCubeUrls(prefix: string, postfix: string) {
  return [
    `${prefix}posx${postfix}`, `${prefix}negx${postfix}`,
    `${prefix}posy${postfix}`, `${prefix}negy${postfix}`,
    `${prefix}posz${postfix}`, `${prefix}negz${postfix}`,
  ]
}
const cubeTextureUrls = generateCubeUrls('/cubeMap2/', '.png')

async function loadTextures() {
  const cubeTextureLoader = new THREE.CubeTextureLoader()
  cubeTexture = await cubeTextureLoader.loadAsync(cubeTextureUrls)

  scene.background = cubeTexture
  scene.environment = cubeTexture

  cubeCamera.update(rend, scene)

  document.body.classList.remove('loading')
}
loadTextures()

const segments = [...(isMobile() ? [90, 18] : [140, 32])]

const sphere = new THREE.SphereGeometry(4.5, segments[0], segments[0])
const teaPot = new TeapotGeometry(3, segments[1])
const torus = new THREE.TorusGeometry(3, 1.5, segments[0], segments[0])
const torusKnot = new THREE.TorusKnotGeometry(2.5, 0.8, segments[0], segments[0])
let geoNames = ['TorusKnot', 'Tea Pot', 'Sphere', 'Torus']
let geometries = {
  'Torus Knot': torusKnot,
  'Tea Pot': teaPot,
  Sphere: sphere,
  Torus: torus,
}

let particleTexture: THREE.Texture
particleTexture = new THREE.TextureLoader().load('/particle.png')

let mesh: THREE.Object3D
let meshGeo: THREE.BufferGeometry

meshGeo = Object.values(geometries)[0]
const phyMat = new THREE.MeshPhysicalMaterial()
phyMat.color = new THREE.Color(0x636363)
phyMat.metalness = 2.0
phyMat.roughness = 0.0
phyMat.side = THREE.DoubleSide


const dissolveUniformData = {
  uEdgeColor: { value: new THREE.Color(0x4d9bff) },
  uFreq: { value: 0.25 },
  uAmp: { value: 16.0 },
  uProgress: { value: -7.0 },
  uEdge: { value: 0.8 }
}

function setupUniforms(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: { [uniform: string]: THREE.IUniform<any> }
) {
  const keys = Object.keys(uniforms)
  for(const key of keys) {
    shader.uniforms[key] = uniforms[key]
  }
}

function setupShader(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>', "#include <common>\n\nvarying vec3 vPos;\n"
  )
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>', "#include <begin_vertex>\n\nvPos = position;\n"
  )

  // fragment shader snippet outside main
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
      varying vec3 vPos;

      uniform float uFreq;
      uniform float uAmp;
      uniform float uProgress;
      uniform float uEdge;
      uniform vec3 uEdgeColor;

      ${snoise}
    `
  )

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    `#include <dithering_fragment>

      // calculate snoise in fragment shader for smooth dissolve edges
      float noise = snoise(vPos * uFreq) * uAmp;

      // discard any fragment where noise is lower than progress
      if(noise < uProgress) discard;

      float edgeWidth = uProgress + uEdge;

      if(noise > uProgress && noise < edgeWidth){
        gl_FragColor = vec4(vec3(uEdgeColor), noise); // colors the edge
      } else {
        gl_FragColor = vec4(gl_FragColor.xyz, 1.0);
      }
    `
  )
}

phyMat.onBeforeCompile = (shader) => {
  setupUniforms(shader, dissolveUniformData)
  setupShader(shader)
}

mesh = new THREE.Mesh(meshGeo, phyMat)
scene.add(mesh)

let particleMesh: THREE.Points
let particleMat = new THREE.ShaderMaterial()
particleMat.transparent = true
particleMat.blending = THREE.AdditiveBlending
let particleCount = meshGeo.attributes.position.count
let maxOffset: Float32Array // -- max distance a particle can move in a step
let initPos: Float32Array // initial position of the particles — loops when pos > max
let currPos: Float32Array // current position of the particle
let velocity: Float32Array // velocity of each particle
let distance: Float32Array
let rotation: Float32Array
let params = {
  particleSpeedFactor: 0.02, // for tweaking velocity
  velocityFactor: { x: 2.5, y: 2 },
  waveAmplitude: 0,
}

function initParticles(meshGeo: THREE.BufferGeometry) {
  particleCount = meshGeo.attributes.position.count
  maxOffset = new Float32Array(particleCount)
  initPos = new Float32Array(meshGeo.getAttribute('position').array)
  currPos = new Float32Array(meshGeo.getAttribute('position').array)
  velocity = new Float32Array(particleCount * 3)
  distance = new Float32Array(particleCount)
  rotation = new Float32Array(particleCount)


  for(let i = 0; i < particleCount; i++) {
    const x = i * 3 + 0
    const y = i * 3 + 1
    const z = i * 3 + 2

    maxOffset[i] = Math.random() * 5.5 + 1.5

    velocity[x] = Math.random() * 0.5 + 0.5
    velocity[y] = Math.random() * 0.5 + 0.5
    velocity[z] = Math.random() * 0.1

    distance[i] = 0.001
    rotation[i] = Math.random() * Math.PI * 2
  }

  meshGeo.setAttribute('aOffset', new THREE.BufferAttribute(maxOffset, 1))
  meshGeo.setAttribute('aCurrentPos', new THREE.BufferAttribute(currPos, 3))
  meshGeo.setAttribute('aVelocity', new THREE.BufferAttribute(velocity, 3))
  meshGeo.setAttribute('aDist', new THREE.BufferAttribute(distance, 1))
  meshGeo.setAttribute('aAngle', new THREE.BufferAttribute(rotation, 1))
}

function waveOffset(idx: number) {
  const pos = {
    x: currPos[idx * 3 + 0],
    y: currPos[idx * 3 + 1],
  }

  const wave = [
    {
      x: Math.sin(pos.y * 2) * (0.8 + params.waveAmplitude),
      y: Math.sin(pos.x * 2) * (0.6 + params.waveAmplitude),
    },
    {
      x: Math.sin(pos.y * 5) * (0.2 + params.waveAmplitude),
      y: Math.sin(pos.x * 1) * (0.9 + params.waveAmplitude),
    },
    {
      x: Math.sin(pos.y * 8) * (0.8 + params.waveAmplitude),
      y: Math.sin(pos.x * 5) * (0.6 + params.waveAmplitude),
    },
    {
      x: Math.sin(pos.y * 3) * (0.8 + params.waveAmplitude),
      y: Math.sin(pos.x * 7) * (0.6 + params.waveAmplitude),
    },
  ]

  const total = wave.reduce((acc, curr) => ({
    x: acc.x + curr.x,
    y: acc.y + curr.y,
  }))

  return total
}

function updateVelocity(idx: number) {
  const v = {
    x: velocity[idx * 3 + 0],
    y: velocity[idx * 3 + 1],
    z: velocity[idx * 3 + 2],
  }

  v.x *= params.velocityFactor.x
  v.y *= params.velocityFactor.y

  const wave = waveOffset(idx)

  v.x += wave.x
  v.y += wave.y

  v.x *= Math.abs(params.particleSpeedFactor)
  v.y *= Math.abs(params.particleSpeedFactor)
  v.z *= Math.abs(params.particleSpeedFactor)

  return v
}

function updateParticles() {
  for(let i = 0; i < particleCount; i++) {
    const x = i * 3 + 0
    const y = i * 3 + 1
    const z = i * 3 + 2

    const v = updateVelocity(i)

    currPos[x] += v.x
    currPos[y] += v.y
    currPos[z] += v.z

    const vec = [
      new THREE.Vector3(...initPos.slice(x, 3)),
      new THREE.Vector3(...currPos.slice(x, 3)),
    ]
    const dist = vec[0].distanceTo(vec[1])

    distance[i] = dist
    rotation[i] += 0.01

    if(dist > maxOffset[i]) {
      currPos[x] = initPos[x]
      currPos[y] = initPos[y]
      currPos[z] = initPos[z]
    }
  }

  meshGeo.setAttribute('aOffset', new THREE.BufferAttribute(maxOffset, 1))
  meshGeo.setAttribute('aCurrentPos', new THREE.BufferAttribute(currPos, 3))
  meshGeo.setAttribute('aVelocity', new THREE.BufferAttribute(velocity, 3))
  meshGeo.setAttribute('aDist', new THREE.BufferAttribute(distance, 1))
  meshGeo.setAttribute('aAngle', new THREE.BufferAttribute(rotation, 1))
}

initParticles(meshGeo)

const particlesUniformData = {
  uTexture: {
    value: particleTexture,
  },
  uPixelDensity: {
    value: rend.getPixelRatio(),
  },
  uProgress: dissolveUniformData.uProgress,
  uEdge: dissolveUniformData.uEdge,
  uAmp: dissolveUniformData.uAmp,
  uFreq: dissolveUniformData.uFreq,
  uBaseSize: { value: isMobile() ? 40 : 80 },
  uColor: { value: new THREE.Color(0x4d9bff) },
}

particleMat.uniforms = particlesUniformData

particleMat.vertexShader = `
  ${snoise}

  uniform float uPixelDensity;
  uniform float uBaseSize;
  uniform float uFreq;
  uniform float uAmp;
  uniform float uEdge;
  uniform float uProgress;

  varying float vNoise;
  varying float vAngle;

  attribute vec3 aCurrentPos;
  attribute float aDist;
  attribute float aAngle;

  void main() {
    vec3 pos = position;

    float noise = snoise(pos * uFreq) * uAmp;
    vNoise = noise;

    vAngle = aAngle;

    if(vNoise > uProgress-2.0 && vNoise < uProgress + uEdge + 2.0) {
      pos = aCurrentPos;
    }

    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;

    float size = uBaseSize * uPixelDensity;
    size = size  / (aDist + 1.0);
    gl_PointSize = size / -viewPosition.z;
  }
`

particleMat.fragmentShader = `
  uniform vec3 uColor;
  uniform float uEdge;
  uniform float uProgress;
  uniform sampler2D uTexture;

  varying float vNoise;
  varying float vAngle;

  void main(){
    if(vNoise < uProgress) discard;
    if(vNoise > uProgress + uEdge) discard;

    vec2 coord = gl_PointCoord;
    coord = coord - 0.5; // get the coordinate from 0-1 ot -0.5 to 0.5
    coord = coord * mat2(cos(vAngle), sin(vAngle), -sin(vAngle), cos(vAngle));
    coord = coord +  0.5; // reset the coordinate to 0-1

    vec4 texture = texture2D(uTexture,coord);

    gl_FragColor = vec4(vec3(uColor.xyz * texture.xyz), 1.0);
  }
`

particleMesh = new THREE.Points(meshGeo, particleMat)
scene.add(particleMesh)

function toDisplaySize() {
  const width = vas.clientWidth * scale
  const height = vas.clientHeight * scale
  const needResize = vas.width !== width || vas.height !== height
  if(needResize) {
    rend.setSize(width, height, false)

    renderPass.setSize(width, height)
    outPass.setSize(width, height)
    unrealBloomPass.setSize(width, height)

    composers[0].setSize(width, height)
    composers[1].setSize(width, height)
  }

  return needResize
}


let tweaks = {
  x: 0,
  z: 0,

  dissolveProgress: dissolveUniformData.uProgress.value,
  edgeWidth: dissolveUniformData.uEdge.value,
  amplitude: dissolveUniformData.uAmp.value,
  frequency: dissolveUniformData.uFreq.value,
  meshVisible: true,
  meshColor: '#' + phyMat.color.getHexString(),
  edgeColor: '#' + dissolveUniformData.uEdgeColor.value.getHexString(),
  autoDissolve: true,
  timeframe: 20,

  particleVisible: true,
  particleBaseSize: particlesUniformData.uBaseSize.value,
  particleColor: '#' + particlesUniformData.uColor.value.getHexString(),
  particleSpeedFactor: params.particleSpeedFactor,
  velocityFactor: params.velocityFactor,
  waveAmplitude: params.waveAmplitude,

  bloomStrength: shaderPass.uniforms.uStrength.value,
  rotationY: mesh.rotation.y,
}


function createTweakList(
  name: string, geos: Record<string, unknown>,
): BladeApi {
  const options = []
  /**
   * ToDo: ¡Fix!
   */
  for(const [text, value] of Object.entries(geos)) {
    options.push({ text, value })
  }

  return pane.addBlade({
    view: 'list',
    label: name,
    options,
    value: Object.values(geos)[0],
  })
}

function handleMeshChange(geo: any) {
  scene.remove(mesh)
  scene.remove(particleMesh)

  meshGeo = geo
  mesh = new THREE.Mesh(geo, phyMat)

  initParticles(geo)
  particleMesh = new THREE.Points(geo, particleMat)

  scene.add(mesh)
  scene.add(particleMesh)
}

const pane = new Pane()
const controller = pane.addFolder({ title: 'Controls', expanded: false })

const meshFolder = controller.addFolder({ title: 'Mesh', expanded: false })
let meshBlade = createTweakList('Mesh', geometries)
if('on' in meshBlade) {
  (meshBlade as any).on(
    'change',
    (val: { value: string }) => { handleMeshChange(val.value) }
  )
}
meshFolder.add(meshBlade)
meshFolder.addBinding(
  tweaks,
  'bloomStrength',
  { min: 1, max: 20, step: 0.01, label: 'Bloom Strength' }
).on('change', (obj) => { shaderPass.uniforms.uStrength.value = obj.value })
meshFolder.addBinding(
  tweaks,
  'rotationY',
  { min: -(Math.PI * 2), max: (Math.PI * 2), step: 0.01, label: 'Rotation Y' }
).on('change', (obj) => { particleMesh.rotation.y = mesh.rotation.y = obj.value })

const dissolveFolder = controller.addFolder(
  { title: 'Dissolve Effect', expanded: false, }
)
dissolveFolder.addBinding(
  tweaks,
  'meshVisible',
  { label: 'Visible' }
).on('change', (obj) => { mesh.visible = obj.value })
let progressBinding = dissolveFolder.addBinding(
  tweaks,
  'dissolveProgress',
  { min: -tweaks.timeframe, max: tweaks.timeframe, step: 0.0001, label: 'Progress' }
).on('change', (obj) => { dissolveUniformData.uProgress.value = obj.value })
dissolveFolder.addBinding(
  tweaks,
  'timeframe',
  { min: 2, max: 20, step: 0.5, label: 'Timeframe' }
).on('change', (obj) => {
  tweaks.timeframe = obj.value
  const progressState = progressBinding.exportState()
  progressState.min = -tweaks.timeframe
  progressState.max = tweaks.timeframe
  progressBinding.importState(progressState)
})
dissolveFolder.addBinding(
  tweaks,
  'autoDissolve',
  { label: 'Auto Animate' }
).on('change', (obj) => { tweaks.autoDissolve = obj.value })
dissolveFolder.addBinding(
  tweaks,
  'edgeWidth',
  { min: 0.1, max: 8, step: 0.001, label: 'Edge Width' }
).on('change', (obj) => { dissolveUniformData.uEdge.value = obj.value })
dissolveFolder.addBinding(
  tweaks,
  'frequency',
  { min: 0.001, max: 2, step: 0.001, label: 'Frequency' }
).on('change', (obj) => { dissolveUniformData.uFreq.value = obj.value })
dissolveFolder.addBinding(
  tweaks,
  'amplitude',
  { min: 0.1, max: 20, step: 0.001, label: 'Amplitude' }
).on('change', (obj) => { dissolveUniformData.uAmp.value = obj.value })
dissolveFolder.addBinding(
  tweaks,
  'meshColor',
  { label: 'Mesh Color' }
).on('change', (obj) => { phyMat.color.set(obj.value) })
dissolveFolder.addBinding(
  tweaks,
  'edgeColor',
  { label: 'Edge Color' }
).on('change', (obj) => { dissolveUniformData.uEdgeColor.value.set(obj.value) })

const particleFolder = controller.addFolder({ title: 'Particle', expanded: false })
particleFolder.addBinding(
  tweaks,
  'particleVisible',
  { label: 'Visible' }
).on('change', (obj) => { particleMesh.visible = obj.value })
particleFolder.addBinding(
  tweaks,
  'particleBaseSize',
  { min: 10.0, max: 100, step: 0.01, label: 'Base size' }
).on('change', (obj) => { particlesUniformData.uBaseSize.value = obj.value })
particleFolder.addBinding(
  tweaks,
  'particleColor',
  { label: 'Color' }
).on('change', (obj) => { particlesUniformData.uColor.value.set(obj.value) })
particleFolder.addBinding(
  tweaks,
  'particleSpeedFactor',
  { min: 0.001, max: 0.1, step: 0.001, label: 'Speed' }
).on('change', (obj) => { params.particleSpeedFactor = obj.value })
particleFolder.addBinding(
  tweaks,
  'waveAmplitude',
  { min: 0, max: 5, step: 0.01, label: 'Wave Amp' }
).on('change', (obj) => { params.waveAmplitude = obj.value })
particleFolder.addBinding(
  tweaks,
  'velocityFactor',
  { expanded: true, picker: 'inline', label: 'Velocity Factor' }
).on('change', (obj) => { params.velocityFactor = obj.value })

let dissolving = true
let geoIdx = 0
const meshes = Object.values(geometries)
let geoLength = meshes.length

function animateDissolve() {
  if(!tweaks.autoDissolve) return
  let progress = dissolveUniformData.uProgress
  if(dissolving) {
    progress.value += isMobile() ? 0.12 : 0.08
  } else {
    progress.value -= isMobile() ? 0.12 : 0.08
  }
  if(progress.value > tweaks.timeframe && dissolving) {
    dissolving = false
    geoIdx++
    handleMeshChange(meshes[geoIdx % geoLength])
    if('value' in meshBlade) {
      meshBlade.value = meshes[geoIdx % geoLength]
    }
  } else if(progress.value < -tweaks.timeframe && !dissolving) {
    dissolving = true
  }

  progressBinding.controller.value.setRawValue(progress.value)
}

function floatMeshes(time: number) {
  mesh.position.set(0, Math.sin(time * 2.0) * 0.5, 0)
  particleMesh.position.set(0, Math.sin(time * 2.0) * 0.5, 0)
}

const clock = new THREE.Clock()
function animate() {
  controls.update()

  let time = clock.getElapsedTime()

  updateParticles()
  floatMeshes(time)
  animateDissolve()

  if(toDisplaySize()) {
    const canvas = rend.domElement
    cam.aspect = canvas.clientWidth / canvas.clientHeight
    cam.updateProjectionMatrix()
  }

  scene.background = blacǩ
  composers[0].render()

  scene.background = cubeTexture
  composers[1].render()
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)

window.addEventListener('orientationchange', () => {
  location.reload()
})
