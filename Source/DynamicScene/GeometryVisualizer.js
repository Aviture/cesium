/*global define*/
define(['../Core/defined',
        '../Core/DeveloperError',
        '../Core/destroyObject',
        '../Core/Dictionary',
        '../Scene/PerInstanceColorAppearance',
        '../Scene/PolylineColorAppearance',
        '../Scene/MaterialAppearance',
        '../Scene/PolylineMaterialAppearance',
        './DynamicGeometryBatch',
        './DynamicObjectCollection',
        './GeometryBatchType',
        './StaticGeometryColorBatch',
        './StaticGeometryPerMaterialBatch',
        './StaticOutlineGeometryBatch'
    ], function(
        defined,
        DeveloperError,
        destroyObject,
        Dictionary,
        PerInstanceColorAppearance,
        PolylineColorAppearance,
        MaterialAppearance,
        PolylineMaterialAppearance,
        DynamicGeometryBatch,
        DynamicObjectCollection,
        GeometryBatchType,
        StaticGeometryColorBatch,
        StaticGeometryPerMaterialBatch,
        StaticOutlineGeometryBatch) {
    "use strict";

    var emptyArray = [];

    /**
     * A DynamicObject visualizer which maps the DynamicPolygon instance
     * in DynamicObject.polygon to a Polygon primitive.
     * @alias GeometryVisualizer
     * @constructor
     *
     * @param {Scene} scene The scene the primitives will be rendered in.
     * @param {DynamicObjectCollection} [dynamicObjectCollection] The dynamicObjectCollection to visualize.
     *
     * @exception {DeveloperError} scene is required.
     *
     * @see DynamicPolygon
     * @see Scene
     * @see DynamicObject
     * @see DynamicObjectCollection
     * @see CompositeDynamicObjectCollection
     * @see VisualizerCollection
     * @see DynamicBillboardVisualizer
     * @see DynamicConeVisualizer
     * @see DynamicConeVisualizerUsingCustomSensorr
     * @see DynamicLabelVisualizer
     * @see DynamicPointVisualizer
     * @see DynamicPolylineVisualizer
     * @see DynamicPyramidVisualizer
     */
    var GeometryVisualizer = function(type, scene, dynamicObjectCollection) {
        if (!defined(scene)) {
            throw new DeveloperError('scene is required.');
        }

        this._type = type;

        var primitives = scene.getPrimitives();
        this._scene = scene;
        this._primitives = primitives;
        this._dynamicObjectCollection = undefined;
        this._addedObjects = new DynamicObjectCollection();
        this._removedObjects = new DynamicObjectCollection();

        this._outlineBatch = new StaticOutlineGeometryBatch(primitives);

        this._batches = [];
        this._batches[GeometryBatchType.COLOR.value] = new StaticGeometryColorBatch(primitives, PerInstanceColorAppearance);
        this._batches[GeometryBatchType.POLYLINE_COLOR.value] = new StaticGeometryColorBatch(primitives, PolylineColorAppearance);
        this._batches[GeometryBatchType.MATERIAL.value] = new StaticGeometryPerMaterialBatch(primitives, MaterialAppearance);
        this._batches[GeometryBatchType.POLYLINE_MATERIAL.value] = new StaticGeometryPerMaterialBatch(primitives, PolylineMaterialAppearance);
        this._batches[GeometryBatchType.DYNAMIC.value] = new DynamicGeometryBatch(primitives);
        this._batches[GeometryBatchType.OUTLINE.value] = this._outlineBatch;

        this._updaters = new Dictionary();
        this.setDynamicObjectCollection(dynamicObjectCollection);
    };

    /**
     * Returns the scene being used by this visualizer.
     *
     * @returns {Scene} The scene being used by this visualizer.
     */
    GeometryVisualizer.prototype.getScene = function() {
        return this._scene;
    };

    /**
     * Gets the DynamicObjectCollection being visualized.
     *
     * @returns {DynamicObjectCollection} The DynamicObjectCollection being visualized.
     */
    GeometryVisualizer.prototype.getDynamicObjectCollection = function() {
        return this._dynamicObjectCollection;
    };

    /**
     * Sets the DynamicObjectCollection to visualize.
     *
     * @param dynamicObjectCollection The DynamicObjectCollection to visualizer.
     */
    GeometryVisualizer.prototype.setDynamicObjectCollection = function(dynamicObjectCollection) {
        var oldCollection = this._dynamicObjectCollection;
        if (oldCollection !== dynamicObjectCollection) {
            if (defined(oldCollection)) {
                oldCollection.collectionChanged.removeEventListener(GeometryVisualizer.prototype._onCollectionChanged, this);
                this.removeAllPrimitives();
            }
            this._dynamicObjectCollection = dynamicObjectCollection;
            if (defined(dynamicObjectCollection)) {
                dynamicObjectCollection.collectionChanged.addEventListener(GeometryVisualizer.prototype._onCollectionChanged, this);
                //Add all existing items to the collection.
                this._onCollectionChanged(dynamicObjectCollection, dynamicObjectCollection.getObjects(), emptyArray);
            }
        }
    };

    /**
     * Updates all of the primitives created by this visualizer to match their
     * DynamicObject counterpart at the given time.
     *
     * @param {JulianDate} time The time to update to.
     *
     * @exception {DeveloperError} time is required.
     */
    GeometryVisualizer.prototype.update = function(time) {
        if (!defined(time)) {
            throw new DeveloperError('time is requied.');
        }

        var addedObjects = this._addedObjects;
        var added = addedObjects.getObjects();
        var removedObjects = this._removedObjects;
        var removed = removedObjects.getObjects();

        var i;
        var g;
        var dynamicObject;
        var id;
        var updater;
        var batch;
        var batches = this._batches;
        for (i = removed.length - 1; i > -1; i--) {
            dynamicObject = removed[i];
            id = dynamicObject.id;
            updater = this._updaters.getValue(id);
            batch = batches[updater.geometryType.value];
            if (defined(batch)) {
                batch.remove(updater);
            }

            updater.destroy();
            this._updaters.remove(id);
        }

        for (i = added.length - 1; i > -1; i--) {
            dynamicObject = added[i];
            id = dynamicObject.id;
            this._updaters.add(id, new this._type(dynamicObject));
        }

        addedObjects.removeAll();
        removedObjects.removeAll();

        var updaters = this._updaters.getValues();

        //Update each updater and if it has changed batch types,
        //re-bit it into a new batch.
        for (g = 0; g < updaters.length; g++) {
            updater = updaters[g];
            var outline = updater.outline;
            var oldType = updater.geometryType;

            updater.update(time);

            var newType = updater.geometryType;
            if (oldType !== newType) {
                batch = batches[oldType.value];
                if (defined(batch)) {
                    batch.remove(updater);
                }
                batch = batches[newType.value];
                if (defined(batch)) {
                    batch.add(updater);
                }
            }
            if (outline !== updater.outline) {
                if (updater.outline) {
                    this._outlineBatch.add(updater);
                } else {
                    this._outlineBatch.remove(updater);
                }
            }
        }

        for (g = 0; g < batches.length; g++) {
            batches[g].update(time);
        }
    };

    /**
     * Removes all primitives from the scene.
     */
    GeometryVisualizer.prototype.removeAllPrimitives = function() {
        this._addedObjects.removeAll();
        this._removedObjects.removeAll();

        var batches = this._batches;
        var batchesLength = batches.length;
        for (var g = 0; g < batchesLength; g++) {
            batches[g].removeAllPrimitives();
        }
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @memberof GeometryVisualizer
     *
     * @returns {Boolean} True if this object was destroyed; otherwise, false.
     *
     * @see GeometryVisualizer#destroy
     */
    GeometryVisualizer.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @memberof GeometryVisualizer
     *
     * @returns {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see GeometryVisualizer#isDestroyed
     *
     * @example
     * visualizer = visualizer && visualizer.destroy();
     */
    GeometryVisualizer.prototype.destroy = function() {
        this.removeAllPrimitives();
        return destroyObject(this);
    };

    GeometryVisualizer.prototype._onCollectionChanged = function(dynamicObjectCollection, added, removed) {
        var addedObjects = this._addedObjects;
        var removedObjects = this._removedObjects;

        var i;
        var dynamicObject;
        for (i = removed.length - 1; i > -1; i--) {
            dynamicObject = removed[i];
            if (!addedObjects.remove(dynamicObject)) {
                removedObjects.add(dynamicObject);
            }
        }

        for (i = added.length - 1; i > -1; i--) {
            dynamicObject = added[i];
            if (!removedObjects.remove(dynamicObject)) {
                addedObjects.add(dynamicObject);
            }
        }
    };

    return GeometryVisualizer;
});
