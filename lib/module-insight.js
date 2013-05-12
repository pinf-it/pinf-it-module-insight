
const PATH = require("path");
const FS = require("fs-extra");
const LINTER = require("jslint/lib/linter");
const ESPRIMA = require("esprima");
const VM = require("vm");


exports.parseFile = function(filePath, options, callback) {
	try {

		options = options || {};

		var descriptor = {
			filename: PATH.basename(filePath),
			filepath: filePath,
			mtime: Math.floor(FS.statSync(filePath).mtime.getTime()/1000),
			code: FS.readFileSync(filePath).toString(),
			globals: {},
			format: null,
			undefine: [],
			dependencies: {
				"static": {},
				"dynamic": {},
				computed: false
			},
			warnings: [],
			errors: []
		};

		if (options.debug) console.log("Parse file:", filePath);

		var extension = filePath.match(/\.([^\.]*)$/)[1];

		function finalize(err) {
			if (err) {
				descriptor.errors.push([
					"parse", err.message, err.stack
				]);
			}
			if (options.test) {
				descriptor.filepath = "test:///" + descriptor.filename;
			}
			return callback(null, descriptor);
		}

		if (extension === "js") {
			return parseJavaScript(descriptor, options, finalize);
		} else
		if (extension === "php") {
			throw new Error("Parsing of PHP files is planned but not yet implemented");
		} else {
			// Fall back to just detecting if file is UTF8 or binary encoded.
			return parseResource(descriptor, options, finalize);
		}


	} catch(err) {
		return callback(err);
	}
}

function parseResource(descriptor, options, callback) {
	try {

		// @see http://stackoverflow.com/a/10391758/330439
		function getEncoding(buffer) {
		    var contentStartBinary = buffer.toString('binary',0,24)
		    var contentStartUTF8 = buffer.toString('utf8',0,24)
		    var encoding = 'utf8'
		    var charCode;
		    for (var i=0 ; i < contentStartUTF8.length ; i++) {
		        charCode = contentStartUTF8.charCodeAt(i);
		        if (charCode === 65533 || charCode <= 8) {
		            // 8 and below are control characters (e.g. backspace, null, eof, etc.)
		            // 65533 is the unknown character
		            encoding = 'binary';
		            break
		        }
		    }
		    return encoding;
		}

		descriptor.format = getEncoding(FS.readFileSync(descriptor.filepath));

		// We don't keep the code for binary files.
		if (descriptor.format === "binary") {
			descriptor.code = null;
		}

		return callback(null);
	} catch(err) {
		return callback(err);
	}
}

function parseJavaScript(descriptor, options, callback) {
	try {

		var syntax = ESPRIMA.parse(descriptor.code);

//console.log("SYNTAX", JSON.stringify(syntax, null, 4));

		// Determine if the code:
		//   1) Invokes globals
		//   2) Assigns globals
		//   3) Uses globals in some fashion
		// Based on this we try to determine:
		//	 1) The module wrapper used if any
		//   2) What the module imports
		//   3) What the module exports

		// TODO: Include if globals are assigned or used only.
		parseSyntax(descriptor, syntax);

		function normalizeDependencyIds(callback) {

			function forType(type) {
				var dependencies = {};
				for (var id in descriptor.dependencies[type]) {
					// Look for requirejs style plugin prefixes.
					var idParts = id.split("!");
					if (idParts.length === 2) {
						dependencies[idParts[1]] = descriptor.dependencies[type][id];
						dependencies[idParts[1]].plugin = idParts[0];
					} else {
						dependencies[id] = descriptor.dependencies[type][id];
					}
				}
				descriptor.dependencies[type] = dependencies;
			}

			forType("static");

			return callback(null);
		}

		function summarize(callback) {

			if (Object.keys(descriptor.globals).length === 0) {

				descriptor.warnings.push([
					"parse-generic", "No global variables found. Thus cannot interface with code."
				]);

				return callback(null);
			} else {

				// If format is not already set, determine ideal module format
				// by looking at globals in order.
				if (!descriptor.format) {
					for (var name in descriptor.globals) {
						if (name === "exports") {
							descriptor.format = "commonjs";
							break;
						} else
						if (name === "define") {
							descriptor.format = "amd-ish";
							break;
						}
					}
				}

				// Some variables get ignored completely.
				var ignore = {
					"arguments": true
				};
				for (var name in descriptor.globals) {
					if (ignore[name]) {
						delete descriptor.globals[name];
					}
				}

				// We should undefine all globals belonging to other formats
				// that the ideal module format is not using.
				var undefine = {
					// http://wiki.commonjs.org/wiki/Modules/1.1
					// http://nodejs.org/api/modules.html
					"commonjs": [
						"require",
						"exports",
						"module"
					],
					// https://github.com/amdjs/amdjs-api/wiki/AMD
					"amd": [
						"define",
						"require"
					],
					"amd-ish": [
						"define",
						"require"
					],
					// http://montagejs.org/
					"montage": [
						"bootstrap"
					],
					// https://code.google.com/p/es-lab/wiki/SecureEcmaScript
					"ses": [
						"ses"
					]
				};
				if (descriptor.format) {
					for (var format in undefine) {
						if (format === descriptor.format) continue;
						undefine[format].forEach(function(name) {
							if (undefine[descriptor.format].indexOf(name) !== -1) return;
							if (descriptor.globals[name] && descriptor.undefine.indexOf(name) === -1) {
								descriptor.undefine.push(name);
							}
						});
					}

					if (descriptor.format === "amd-ish") {
						return discoverDefineishStaticDependencies(descriptor, callback);
					}
				}
				return callback(null);
			}
		}

		return normalizeDependencyIds(function(err) {
			if (err) return callback(err);

			return summarize(function(err) {
				if (err) return callback(err);

				if (!descriptor.format) {
					descriptor.warnings.push([
						"parse", "Could not detect module format."
					]);
				}

				// TODO: Lint the code to parse out other info.
				//var lint = LINTER.lint(code, {});

				return callback(null);
			});
		});

	} catch(err) {
		return callback(err);
	}
}


function discoverDefineishStaticDependencies(descriptor, callback) {
	// Try and run code so `define` gets called in order to determine static dependencies.
	function define(id, dependencies, moduleInitializer) {
		if (typeof dependencies === "undefined" && typeof moduleInitializer === "undefined") {
			dependencies = [];
		} else
		if (Array.isArray(id) && typeof dependencies === "function" && typeof moduleInitializer === "undefined") {
			dependencies = id;
		} else
        if (typeof id === "string" && typeof dependencies === "function" && typeof moduleInitializer === "undefined") {
            dependencies = [];
        }
		if (dependencies) {
			dependencies.forEach(function(id) {
				descriptor.dependencies.static[id] = {
					// TODO: Parse `moduleInitializer.toString()` for `varname`s.
					"where": "declared"
				}
			});
		}
	}
	define.amd = true;
    VM.runInNewContext(descriptor.code, {
    	define: define,
    	// Fake common globals.
    	window: {}
    }, descriptor.filepath, true);	
	return callback(null);
}


function parseSyntax(descriptor, node) {

	function Scope(parent) {
		this.variables = (parent && [].concat(parent.variables)) || [];
	}

	function traverseForEach(nodes, scope) {
		if (!nodes) return;
		nodes.forEach(function(item) {
			traverse(item, scope);
		});
	}

	var topStack = [];

	function traverse(node, scope) {
		if (!node) return;

		if (topStack !== null) {
			topStack.push(node.type);
		}

//console.log("NODE", JSON.stringify(node, null, 4));

		// Nodes that create a new scope.

		if (node.type === "CallExpression") {

			// Look for the first `define()` if we don't already have a format established.
			if (
				!descriptor.format &&
				node.callee.type === "Identifier" &&
				node.callee.name === "define" &&
				Object.keys(descriptor.globals).length === 0
			) {
				descriptor.globals["define"] = {
					type: "variable"
				};
				// See if `define()` is at the top of the module.
				if (topStack && topStack.join(":") === "Program:ExpressionStatement:CallExpression") {
					descriptor.format = "amd";
				} else {
					descriptor.format = "amd-ish";
				}
				var subScope = new Scope(scope);
				node.arguments.forEach(function(argument) {
					if (argument.type === "Literal") {
						// Ignore declared module ID. We always identify module by filename.
					} else
					if (argument.type === "ArrayExpression") {
						argument.elements.forEach(function(dep) {
							if (dep.type === "Literal") {
								descriptor.dependencies["static"][dep.value] = {
									where: "declared"
								};
							} else {
								// We found a computed dependency.
								descriptor.dependencies.computed = true;
								descriptor.format = "amd-ish";
							}
						});
						if (descriptor.format !== "amd") {
							descriptor.dependencies["static"] = {};
						}
					} else
					if (argument.type === "FunctionExpression") {
						var staticDependencies = Object.keys(descriptor.dependencies["static"]);
						argument.params.forEach(function(param, index) {
							subScope.variables.push(param.name);
							if (descriptor.format === "amd") {
								if (staticDependencies.length > 0) {
									// Associate the variable name with the static dependency.
									descriptor.dependencies["static"][staticDependencies[index]].varname = param.name;
								} else {
									// If we did not establish static dependencies above
									// we have standard arguments such as in the case of a
									// commonjs wrapper.
									// e.g. `define(function (require, exports, module) {`
									descriptor.dependencies["static"][param.name] = {
										varname: param.name,
										where: "declared"
									};
								}
							}
						});
					}
				});
				topStack = null;
				traverse(node.arguments[node.arguments.length-1].body, subScope);
			} else
			// Look for `require()` calls.
			if (node.callee.type === "Identifier" && node.callee.name === "require") {
				if (node.arguments.length === 1 && node.arguments[0].type === "Literal") {
					descriptor.dependencies["static"][node.arguments[0].value] = {
						where: "inline"
					};
				} else
				if (node.arguments.length >= 1 && node.arguments[0].type === "ArrayExpression") {
					node.arguments[0].elements.forEach(function(dep) {
						if (dep.type === "Literal") {
							if (!descriptor.dependencies["static"][dep.value]) {
								descriptor.dependencies["dynamic"][dep.value] = {
									where: "inline"
								};
							}
						} else {
							descriptor.dependencies.computed = true;
						}
					});
				}
				if (scope.variables.indexOf("require") === -1) {
					descriptor.globals["require"] = {
						type: "variable"
					};
				}
			} else {
				topStack = null;
				traverseForEach(node.arguments, scope);
				traverse(node.callee, scope);
			}
		} else
		if (
			node.type === "FunctionDeclaration" ||
			node.type === "FunctionExpression"
		) {
			if (node.id) {
				scope.variables.push(node.id.name);
			}
			var subScope = new Scope(scope);
			node.params.forEach(function(param) {
				subScope.variables.push(param.name);
			});
			traverse(node.body, subScope);
		} else

		// Nodes that test for, use or declare variables.

		if (node.type === "UnaryExpression") {
			if (
				node.operator === "typeof" &&
				node.argument.type === "Identifier"
			) {
				if (scope.variables.indexOf(node.argument.name) === -1 && !descriptor.globals[node.argument.name]) {
					descriptor.globals[node.argument.name] = {
						type: "typeof"
					};
				}
			} else {
				traverse(node.argument, scope);
			}
		} else
		if (node.type === "VariableDeclaration") {
			traverseForEach(node.declarations, scope);
		} else
		if (node.type === "VariableDeclarator") {
			scope.variables.push(node.id.name);
			traverse(node.init, scope);
		} else
		if (node.type === "Identifier") {
			if (scope.variables.indexOf(node.name) === -1 && !descriptor.globals[node.name]) {
				descriptor.globals[node.name] = {
					type: "variable"
				};
			}
		} else

		// Other nodes that use existing scope.

		if (node.type === "Program") {
			traverseForEach(node.body, scope);
		} else
		if (node.type === "Literal") {
		} else
		if (node.type === "MemberExpression") {
			traverse(node.object, scope);
		} else
		if (node.type === "ThisExpression") {
		} else
		if (node.type === "ReturnStatement") {
			traverse(node.argument, scope);
		} else
		if (node.type === "Property") {
			traverse(node.value, scope);
		} else
		if (node.type === "NewExpression") {
			traverse(node.callee, scope);
			traverseForEach(node.body, scope);
		} else
		if (node.type === "ObjectExpression") {
			traverseForEach(node.properties, scope);
//			traverseForEach(node.body, scope);
		} else
		if (node.type === "LogicalExpression") {
			traverse(node.left, scope);
			traverse(node.right, scope);
		} else
		if (node.type === "ExpressionStatement") {
			traverse(node.expression, scope);
		} else
		if (node.type === "AssignmentExpression") {
			traverse(node.left, scope);
			traverse(node.right, scope);
		} else
		if (node.type === "ArrayExpression") {
			traverseForEach(node.elements, scope);
		} else
		if (node.type === "ForStatement") {
			traverse(node.body, scope);
		} else
		if (node.type === "ForInStatement") {
			traverse(node.left, scope);
			traverse(node.right, scope);
			traverse(node.body, scope);
		} else
		if (node.type === "BinaryExpression") {
			traverse(node.left, scope);
			traverse(node.right, scope);
		} else
		if (node.type === "ConditionalExpression") {
			traverse(node.test, scope);
			traverse(node.consequent, scope);
			traverse(node.alternate, scope);
		} else
		if (node.type === "IfStatement") {
			traverse(node.test, scope);
			traverse(node.consequent, scope);
			traverse(node.alternate, scope);
		} else
		if (node.type === "WhileStatement") {
			traverse(node.test, scope);
			traverse(node.body, scope);
		} else
		if (node.type === "BlockStatement") {
			traverseForEach(node.body, scope);
		} else {
			// TODO: Don't throw here and just stop traversing deeper
			//		 once we have all nodes that need to be traversed above.
			throw new Error("Unknown node type '" + node.type + "'");
		}
	}

	traverse(node, new Scope());
}
