import * as THREE from 'three';
import type { SceneObject } from './projects';

export class PlacementController {
  private static readonly GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /**
   * Snaps the object to the target coordinate origin.
   */
  public static snapToTarget(object: SceneObject): SceneObject {
    return {
      ...object,
      position: [0, 0, 0],
    };
  }

  /**
   * Aligns the object's bottom to the detected surface plane (Y = 0).
   */
  public static alignToSurface(object: SceneObject): SceneObject {
    return {
      ...object,
      position: [object.position[0], 0, object.position[2]],
      rotation: [0, object.rotation[1], 0],
    };
  }

  /**
   * Places the object in front of the viewer/camera along the forward axis.
   */
  public static placeInFrontOfCamera(object: SceneObject, distance = 1.5): SceneObject {
    return {
      ...object,
      position: [0, 0, -distance],
    };
  }

  /**
   * Resets position, rotation and scale to standard defaults.
   */
  public static resetTransform(object: SceneObject): SceneObject {
    return {
      ...object,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
  }

  /**
   * Applies uniform scale change across all 3 axes.
   */
  public static setUniformScale(object: SceneObject, scaleValue: number): SceneObject {
    const s = Math.max(0.05, Math.min(20, scaleValue));
    return {
      ...object,
      scale: [s, s, s],
    };
  }

  /**
   * Increments or decrements a single transform coordinate by delta.
   */
  public static fineStep(
    object: SceneObject,
    field: 'position' | 'rotation' | 'scale',
    axisIndex: 0 | 1 | 2,
    delta: number
  ): SceneObject {
    const arr = [...object[field]] as [number, number, number];
    arr[axisIndex] = Number((arr[axisIndex] + delta).toFixed(3));
    if (field === 'scale' && arr[axisIndex] < 0.05) {
      arr[axisIndex] = 0.05;
    }
    return {
      ...object,
      [field]: arr,
    };
  }

  /**
   * Raycasts a 2D screen/touch point onto the AR reference ground plane.
   */
  public static screenPointToGround(
    normalizedX: number, // -1..1
    normalizedY: number, // -1..1
    camera: THREE.Camera
  ): [number, number, number] | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(normalizedX, normalizedY), camera);

    const hitPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(this.GROUND_PLANE, hitPoint);
    if (hit) {
      return [
        Number(hitPoint.x.toFixed(3)),
        Number(hitPoint.y.toFixed(3)),
        Number(hitPoint.z.toFixed(3)),
      ];
    }
    return null;
  }
}
