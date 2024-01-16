// Copyright 2015, 2016, 2019 Kevin Reid and the ShinySDR contributors
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

// WebGL vertex shader for drawing the map's globe.

// Position in 3-dimensional coordinates.
attribute mediump vec3 position;
varying highp vec3 v_position;

// Position in 2-dimensional coordinates (longitude, latitude); used to texture the sphere.
attribute highp vec2 lonlat;
varying highp vec2 v_lonlat;

// Camera projection.
uniform highp mat4 projection;

void main(void) {
  gl_Position = vec4(position, 1.0) * projection;
  v_lonlat = lonlat;
  v_position = position;
}
