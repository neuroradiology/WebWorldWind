/*
 * Copyright (C) 2014 United States Government as represented by the Administrator of the
 * National Aeronautics and Space Administration. All Rights Reserved.
 */
/**
 * @exports ColladaMesh
 */

define(['./ColladaUtils'], function (ColladaUtils) {
    "use strict";

    /**
     * Constructs a ColladaMesh
     * @alias ColladaMesh
     * @constructor
     * @classdesc Represents a collada mesh tag.
     * @param {String} geometryId The id of a geometry node
     */
    var ColladaMesh = function (geometryId) {
        this.filename = geometryId || "";
        this.name = geometryId || "";
        this.buffers = [];
    };

    /**
     * Parses and computes the geometry of a mesh.
     * Internal. Applications should not call this function.
     * @param {Node} element A mesh node.
     */
    ColladaMesh.prototype.parse = function (element) {

        var sources = {}, meshData = {};

        for (var i = 0; i < element.childNodes.length; i++) {

            var child = element.childNodes[i];

            if (child.nodeType !== 1) {
                continue;
            }

            switch (child.nodeName) {

                case 'source':
                    if (!child.querySelector) {
                        continue;
                    }

                    var floatArray = child.querySelector("float_array");
                    if (!floatArray) {
                        continue;
                    }

                    var values = ColladaUtils.bufferDataFloat32(floatArray);
                    var accessor = child.querySelector("accessor");
                    var stride = parseInt(accessor.getAttribute("stride"));

                    sources[child.getAttribute("id")] = {stride: stride, data: values};
                    break;

                case 'vertices':
                    var vertices = child.querySelector("input");
                    var verticesSource = sources[vertices.getAttribute("source").substr(1)];
                    sources[child.getAttribute("id")] = verticesSource;
                    break;

                case 'triangles':
                    meshData = this.parsePolygons(child, sources, 3);
                    this.buffers.push(meshData);
                    break;

                case 'polygons':
                    meshData = this.parsePolygons(child, sources, 4);
                    this.buffers.push(meshData);
                    break;

                case 'polylist':
                    meshData = this.parsePolygons(child, sources, null);
                    this.buffers.push(meshData);
                    break;

                default:
                    break;

            }

        }

        return this;

    };

    /**
     * Parses the polygons primitive and computes the indices and vertices.
     * Internal. Applications should not call this function.
     * @param {Node} element.
     * @param {Object} sources An object containing the inputs for vertices, normals and uvs.
     * @param {Number} vCount Optional parameter, specifies the the vertex count for a polygon
     */
    ColladaMesh.prototype.parsePolygons = function (element, sources, vCount) {

        var arrVCount = [];
        if (vCount == null) {
            var xmlVCount = element.querySelector("vcount");
            arrVCount = xmlVCount.textContent.trim().split(" ");
        }

        var count = parseInt(element.getAttribute("count"));
        var material = element.getAttribute("material");

        var inputData = this.parseInputs(element, sources);
        var inputs = inputData.inputs;
        var maxOffset = inputData.maxOffset;

        var primitives = element.querySelector("p");
        var primitiveData = [];
        if (primitives) {
            primitiveData = primitives.textContent.trim().split(" ");
        }

        var nrOfInputs = inputs.length;

        var lastIndex = 0;
        var indexMap = {};
        var indicesArray = [];
        var pos = 0;

        for (var i = 0; i < count; i++) {

            if (arrVCount.length) {
                var numVertices = parseInt(arrVCount[i]);
            }
            else {
                numVertices = vCount;
            }

            var firstIndex = -1;
            var currentIndex = -1;
            var prevIndex = -1;

            for (var k = 0; k < numVertices; k++) {

                var vecId = primitiveData.slice(pos, pos + maxOffset).join(" ");

                prevIndex = currentIndex;
                if (indexMap.hasOwnProperty(vecId)) {
                    currentIndex = indexMap[vecId];
                }
                else {

                    for (var j = 0; j < nrOfInputs; j++) {

                        var input = inputs[j];
                        var offset = input[4];
                        var index = parseInt(primitiveData[pos + offset]);
                        var array = input[1];
                        var source = input[3];
                        index *= input[2];

                        for (var x = 0; x < input[2]; x++) {
                            array.push(source[index + x]);
                        }
                    }

                    currentIndex = lastIndex;
                    lastIndex += 1;
                    indexMap[vecId] = currentIndex;
                }

                if (numVertices > 3) {
                    if (k === 0) {
                        firstIndex = currentIndex;
                    }
                    if (k > 2 * maxOffset) {
                        indicesArray.push(firstIndex);
                        indicesArray.push(prevIndex);
                    }
                }

                indicesArray.push(currentIndex);
                pos += maxOffset;

            }
        }

        var mesh = {
            vertices: new Float32Array(inputs[0][1]),
            material: material
        };

        this.transformMeshInfo(mesh, inputs, indicesArray);

        return mesh;

    };

    /**
     * Parses the inputs of a mesh.
     * Internal. Applications should not call this function.
     * @param {Node} element.
     * @param {Object} sources An object containing the vertices source and stride.
     */
    ColladaMesh.prototype.parseInputs = function (element, sources) {

        var inputs = [], maxOffset = 0;

        var xmlInputs = element.querySelectorAll("input");

        for (var i = 0; i < xmlInputs.length; i++) {
            var xmlInput = xmlInputs.item(i);
            if (!xmlInput.getAttribute) {
                continue;
            }

            var semantic = xmlInput.getAttribute("semantic").toUpperCase();
            var sourceUrl = xmlInput.getAttribute("source");
            var source = sources[sourceUrl.substr(1)];
            var offset = parseInt(xmlInput.getAttribute("offset"));

            maxOffset = ( maxOffset < offset + 1 ) ? offset + 1 : maxOffset;

            //indicates which inputs should be grouped together as a single set.
            //multiple inputs may share the same semantics.
            var dataSet = 0;
            if (xmlInput.getAttribute("set")) {
                dataSet = parseInt(xmlInput.getAttribute("set"));
            }

            inputs.push([semantic, [], source.stride, source.data, offset, dataSet]);
        }

        return {inputs: inputs, maxOffset: maxOffset};
    };

    /**
     * Packs the data in the mesh object.
     * Internal. Applications should not call this function.
     * @param {Object} mesh The mesh that will be returned.
     * @param {Array} inputs An array containing geometry data.
     * @param {Array} indicesArray An array containing the indices.
     */
    ColladaMesh.prototype.transformMeshInfo = function (mesh, inputs, indicesArray) {
        var translator = {
            "normal": "normals",
            "texcoord": "uvs"
        };

        for (var i = 1; i < inputs.length; i++) {

            var name = inputs[i][0].toLowerCase(); //the semantic
            var data = inputs[i][1]; //the final data (normals, uvs)

            if (!data.length) {
                continue;
            }

            if (translator[name]) {
                name = translator[name];
            }

            if (mesh[name]) {
                name = name + inputs[i][5];
            }

            mesh[name] = new Float32Array(data);

            if (name === 'uvs') {
                mesh.isClamp = ColladaUtils.getTextureType(data);
            }
        }

        mesh.indices = new Uint16Array(indicesArray);

        return mesh;
    };

    return ColladaMesh;
});
