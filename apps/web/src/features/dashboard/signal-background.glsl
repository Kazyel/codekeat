uniform float uTime;
uniform float uContrast;
uniform vec2 uResolution;
uniform vec3 uBase;
uniform vec3 uRed;
uniform vec3 uOrange;
varying vec2 vUv;

void main() {
	vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0);
	float time = uTime * 0.085;
	float flow = p.y
		+ 0.21 * sin(p.x * 1.45 - time)
		+ 0.085 * cos(p.x * 3.2 + time * 0.6)
		+ 0.025 * sin(p.x * 7.0 - p.y * 3.0 + time);

	float bands = flow * 19.0;
	float edge = abs(fract(bands) - 0.5);
	float contour = 1.0 - smoothstep(0.012, 0.012 + fwidth(bands), edge);
	float satin = pow(0.5 + 0.5 * sin(flow * 6.0 - p.x * 0.65), 4.0);
	float mask = smoothstep(0.32, 0.94, vUv.x)
		* smoothstep(0.0, 0.15, vUv.y)
		* (1.0 - smoothstep(0.8, 1.0, vUv.y));
	vec3 ink = mix(uRed, uOrange, smoothstep(0.35, 1.0, vUv.x));
	float amount = mask * uContrast * (0.012 * satin + 0.055 * contour);
	vec3 color = mix(uBase, ink, amount);

	float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
	color += (grain - 0.5) * 0.0015 * mask;
	gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
