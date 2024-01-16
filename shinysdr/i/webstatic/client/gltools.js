// Copyright 2015, 2018, 2020 Kevin Reid and the ShinySDR contributors
// 
// This file is part of ShinySDR.
// 
// ShinySDR is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// ShinySDR is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with ShinySDR.  If not, see <http://www.gnu.org/licenses/>.

'use strict';

define(() => {
  const exports = {};
  
  // Set up a WebGL context according to ShinySDR-specific rules.
  // Note: make sure that domtools.lifecycleInit is called on the canvas (this is automatic if it is directly a widget) to enable prompt cleanup of the context.
  exports.getGL = function getGL(config, canvas, options) {
    const useWebGL = config.clientState.opengl.depend(config.rebuildMe);
    const gl = !useWebGL ? null : canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
    
    // Set up an automatic loseContext.
    const loseContextExt = gl && gl.getExtension('WEBGL_lose_context');
    if (loseContextExt) {
      canvas.addEventListener('shinysdr:lifecycledestroy', event => {
        loseContextExt.loseContext();
      });
    }
    
    return gl;
  };
  
  const buildProgram = exports.buildProgram =
      function buildProgram(gl, vertexShaderSource, fragmentShaderSource) {
    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    }
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    // Check errors after all prior steps. This allows the compilation to proceed in parallel.
    // It would be even better to do this fully asynchronously (KHR_parallel_shader_compile).
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(vertexShader));
    }
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(vertexShader));
    }
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    
    gl.useProgram(program);
    return program;
  };
  
  exports.handleContextLoss = function handleContextLoss(canvas, callback) {
    canvas.addEventListener('webglcontextlost', function (event) {
      event.preventDefault();
    }, false);
    canvas.addEventListener('webglcontextrestored', callback, false);
  };
  
  // Manage a float vertex attribute array and compute the indices.
  // layoutEntries is an array of { name: <shader's attribute name>, components: <integer> }.
  class AttributeLayout {
    constructor(gl, program, layoutEntries) {
      this._gl = gl;
      this._BPE = Float32Array.BYTES_PER_ELEMENT;
      this._elementsPerVertex = 0;
      this.offsets = Object.create(null);
      this._complete = [];
      layoutEntries.forEach(entry => {
        const attribLocation = gl.getAttribLocation(program, entry.name);
        if (attribLocation === -1) {
          throw new Error('attribute ' + JSON.stringify(entry.name) + ' is not defined or otherwise invalid');
        }
      
        const offset = this._elementsPerVertex;
        this._elementsPerVertex += entry.components;

        this.offsets[entry.name] = offset;
        this._complete.push({
          attrib: attribLocation,
          components: entry.components,
          byteOffset: offset * this._BPE
        });
      });
      Object.freeze(this.offsets);
      Object.freeze(this);
    }
    
    elementsPerVertex() {
      return this._elementsPerVertex;
    }
    
    // the relevant buffer should be already bound
    attrib() {
      const gl = this._gl;
      const stride = this._elementsPerVertex * this._BPE;
      this._complete.forEach(layoutItem => {
        gl.enableVertexAttribArray(layoutItem.attrib);
        gl.vertexAttribPointer(
          layoutItem.attrib,
          layoutItem.components,
          gl.FLOAT,
          false,
          stride,
          layoutItem.byteOffset);
      });
    }
    
    unattrib() {
      const gl = this._gl;
      this._complete.forEach(function (layoutItem) {
        gl.disableVertexAttribArray(layoutItem.attrib);
      }, this);
    }
  }
  exports.AttributeLayout = AttributeLayout;
  
  class SingleQuad {
    constructor(gl, nx, px, ny, py, positionAttribute) {
      const quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        // full screen triangle strip
        nx, ny, 0, 1,
        px, ny, 0, 1,
        nx, py, 0, 1,
        px, py, 0, 1
      ]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    
      this.draw = function drawSingleQuad() {
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(positionAttribute);
        gl.vertexAttribPointer(
          positionAttribute,
          4, // components
          gl.FLOAT,
          false,
          0,
          0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);  // 4 vertices
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.disableVertexAttribArray(positionAttribute);
      };
    }
  }
  exports.SingleQuad = SingleQuad;
  
  // Sets up render-to-texture then texture-to-screen-via-shader.
  //
  // Calling this constructor overwrites texture unit 0 binding and bindFramebuffer.
  class PostProcessor {
    constructor(gl, {format, type, fragmentShader}) {
      const framebuffer = gl.createFramebuffer();
    
      const framebufferTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, framebufferTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
    
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, framebufferTexture, 0);
      // console.log(WebGLDebugUtils.glEnumToString(gl.checkFramebufferStatus(gl.FRAMEBUFFER)));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
      const postProcessProgram = buildProgram(gl,
        // vertex shader
        ''
        + 'attribute highp vec4 position;\n'
        + 'varying highp vec2 pp_texcoord;\n'
        + 'void main(void) {\n'
        + '  gl_Position = position;\n'
        + '  pp_texcoord = position.xy * vec2(0.5) + vec2(0.5);\n'
        + '}\n',
        // fragment shader
        ''
        + 'uniform sampler2D pp_texture;\n'
        + 'uniform highp vec2 pp_size;\n'
        + 'varying highp vec2 pp_texcoord;\n'
        + fragmentShader);
      const positionAttribute = gl.getAttribLocation(postProcessProgram, 'position');
      gl.uniform1i(gl.getUniformLocation(postProcessProgram, 'pp_texture'), 0);
    
      const quad = new SingleQuad(gl, -1, +1, -1, +1, positionAttribute);
    
      let w = 1;
      let h = 1;
      // Calling this method overwrites texture unit 0 binding.
      this.setSize = function setSize(newW, newH) {
        w = newW;
        h = newH;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, framebufferTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, type, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      };
    
      // For use to set uniforms on the postprocessing program.
      this.getProgram = function getProgram() {
        return postProcessProgram;
      };
    
      this.beginInput = function beginInput() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      };
    
      this.endInput = function endInput() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      };
    
      // Calling this method overwrites texture unit 0 binding, the current program, and ARRAY_BUFFER binding.
      this.drawOutput = function drawOutput() {
        gl.useProgram(postProcessProgram);
        gl.uniform2f(gl.getUniformLocation(postProcessProgram, 'pp_size'), w, h);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, framebufferTexture);
        quad.draw();
        gl.bindTexture(gl.TEXTURE_2D, null);
      };
    }
  }
  exports.PostProcessor = PostProcessor;

  return Object.freeze(exports);
});
