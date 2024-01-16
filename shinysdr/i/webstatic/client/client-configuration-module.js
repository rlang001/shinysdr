// Copyright 2015, 2019 Kevin Reid and the ShinySDR contributors
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

// This module is basically a shim for the server's client-configuration resource to be loaded as a module (and parsed only once).

'use strict';

define(['text!client-configuration.json'], (text) => {
  const exports = {};
  
  const clientConfiguration = JSON.parse(text);
  const pluginIndex = clientConfiguration.plugins;
  const moduleIds = Object.freeze(Array.prototype.slice.call(pluginIndex.js));
  
  const modeTable = Object.create(null);
  for (const k in pluginIndex.modes) {
    modeTable[k] = Object.freeze(pluginIndex.modes[k]);
  }
  Object.freeze(modeTable);
  
  exports.loadCSS = function () {
    Array.prototype.forEach.call(pluginIndex.css, cssUrl => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = String(cssUrl);
      document.querySelector('head').appendChild(link);
    });
  };
  
  exports.getJSModuleIds = function () {
    return moduleIds;
  };
  
  exports.getModeTable = function () {
    return modeTable;
  };
  
  exports.getSharedTestObjectsURL = () => clientConfiguration.shared_test_objects_url;
  
  return Object.freeze(exports);
});
