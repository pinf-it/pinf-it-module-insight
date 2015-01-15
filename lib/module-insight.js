
const PATH = require("path");
const FS = require("fs-extra");
const LINTER = require("jslint/lib/linter");
const ESPRIMA = require("esprima");
const VM = require("vm");


exports.parseFile = function(filePath, options, callback) {

	options = options || {};

	options.API = {
		FS: (options.$pinf && options.$pinf.getAPI("FS")) || FS
	};

	options._realpath = function(path) {
		if (!options.rootPath) return path;
		if (/^\//.test(path)) return path;
		return PATH.join(options.rootPath, path);
	}

	function bypassIfWeCan(proceedCallback) {
		if (!options.$pinf) {
			return proceedCallback(callback);
		}
		var gateway = options.$pinf.gateway("vfs-write-from-read-mtime-bypass", {
			verbose: false
		});
		// All criteria that makes this call (argument combination) unique.
		gateway.setKey({
			filePath: filePath
		});
		// NOTE: `callback` will be called by gateway right away if we can bypass.
		return gateway.onDone(callback, function(err, proxiedCallback) {
			if (err) return 
			// If callback was triggered above we will get an empty callback back so we can just stop here.
			if (!proxiedCallback) return;
			options.API.FS = gateway.getAPI("FS");
			return proceedCallback(function() {
				return proxiedCallback.apply(this, arguments);
			});
		}, function(cachedData) {
			return callback(null, cachedData);
		});
	}

	return bypassIfWeCan(function(callback) {

		try {

			if (options.debug) console.log("Code file path:", options._realpath(filePath));

			var descriptor = {
				filename: PATH.basename(filePath),
				filepath: filePath,
				mtime: Math.floor(options.API.FS.statSync(options._realpath(filePath)).mtime.getTime()/1000),
				code: options.API.FS.readFileSync(options._realpath(filePath)).toString(),
				globals: {},
				syntax: null,
				format: null,
				undefine: [],
				uses: {},
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
				return callback(null, descriptor, descriptor);
			}

			if (extension === "js") {
				descriptor.syntax = "javascript";
				return parseJavaScript(descriptor, options, finalize);
			} else
			if (extension === "php") {
				descriptor.syntax = "php";
				throw new Error("Parsing of PHP files is planned but not yet implemented");
			} else
			if (extension === "json") {
				descriptor.syntax = "json";
				// TODO: Validate JSON.
				descriptor.format = "json";
				return finalize(null);
			} else
			if (extension === "scss") {
				descriptor.format = "scss";
				return finalize(null);
			} else
			if (extension === "css") {
				descriptor.format = "css";
				return finalize(null);
			} else {
				// Fall back to just detecting if file is UTF8 or binary encoded.
				return parseResource(descriptor, options, finalize);
			}

		} catch(err) {
			return callback(err);
		}
	});
}

function parseResource(descriptor, options, callback) {
	try {

		if (options.debug) console.log("parseResource");

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

		descriptor.format = getEncoding(options.API.FS.readFileSync(options._realpath(descriptor.filepath)));

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

//		if (options.debug) console.log("parseJavaScript");

		descriptor.code = descriptor.code.replace(/^\s*#.*/g, "");

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

//			if (options.debug) console.log("normalizeDependencyIds");

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
			forType("dynamic");

			return callback(null);
		}

		function summarize(callback) {

//			if (options.debug) console.log("summarize");

			// HACK: If we detect that module loads its own loader we just wrap it.
			if (/http:\/\/github.com\/jrburke\/requirejs/.test(descriptor.code)) {
				descriptor.dependencies.static = {};
				descriptor.syntax = "javascript";
				descriptor.format = "commonjs";
				return callback(null);
			}


			if (Object.keys(descriptor.globals).length === 0) {

				if (!descriptor.format) {
					if (descriptor.syntax === "javascript") {
						descriptor.format = "encapsulated";
					}
				}

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
						if (
							name === "define" &&
							descriptor.globals[name].type !== "assign"
						) {
							descriptor.format = "amd-ish";
							break;
						}
					}
				} else
				// If format already set adjust it if necessary.
				{
					if (descriptor.format === "amd-ish") {
						if (
							descriptor.globals["define"] &&
							descriptor.globals["define"].type === "assign"
						) {
							descriptor.format = "commonjs";
						}
					}
				}

				if (!descriptor.format) {
					if (descriptor.syntax === "javascript") {
						descriptor.format = "leaky";
					}
				}

				// Some variables get ignored completely.
				var ignore = {
					"arguments": true,
					"undefined": true
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
							if (!undefine[descriptor.format]) return;
							if (undefine[descriptor.format].indexOf(name) !== -1) return;
							if (descriptor.globals[name] && descriptor.undefine.indexOf(name) === -1) {
								descriptor.undefine.push(name);
							}
						});
					}

					if (descriptor.format === "amd-ish") {
						return discoverDefineishStaticDependencies(options, descriptor, callback);
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
		err.message += " (while parsing: " + descriptor.filename + ")";
		return callback(err);
	}
}


function discoverDefineishStaticDependencies (options, descriptor, callback) {
	if (options.debug) console.log("discoverDefineishStaticDependencies() - START");
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
	define.amd = {
		jQuery: true
	};
	try {

		// TODO: Execute this in a separate process so we don't have to quit if there is an error!
		//       @see https://github.com/pinf-it/pinf-it-module-insight/issues/1


		// HACK: If these run on node 0.10 the bundling process stops for some reason.
		// TODO: Remove these once VM module can run code properly. Currently does not inject `document` global.
		// TODO: Use full DOM the way pinf-it-bundler does.
		if (/\/jquery\.js$/.test(descriptor.filepath)) {
			// TODO: Run more detailed checks to ensure we are looking at the jquery library.
			// stock jquery has no dependencies so we can just return here.
			if (options.debug) console.error("[pinf-it-module-insight] node vm exec (SKIP):", descriptor.filepath);
			return callback(null);
		}


		else {
			// TODO: Undefine or pre-feed global variables based on what we have already discovered
			//       so we can clean all this up.
			var win = {
				document: {}
			};
			var require = function () {};
			require.def = define;
			var $ = function () {};
			$.fn = {};
			if (options.debug) console.error("[pinf-it-module-insight] node vm exec:", descriptor.filepath);
		    VM.runInNewContext(descriptor.code, {
		    	define: define,
		    	// Provide common globals.
		    	console: console,
		    	// Fake common globals.
		    	window: win,
		    	navigator: {},
		    	require: require,
		    	document: win.document,
		    	jQuery: $,
		    	$: $
		    }, descriptor.filepath, true);
		}
	} catch(err) {
		console.error("run code error", err.stack);
		if (options.debug) console.log("discoverDefineishStaticDependencies() - END");
		return callback(null);
	}
	return callback(null);
}


function parseSyntax(descriptor, node) {

	var topStack = [];

	function Scope(top) {
		this.top = top || false;
		this.declared = {};
		this.used = {};
	}
	Scope.prototype.declareVariable = function(name) {
		this.declared[name] = true;
		if (this.top) {
			this.useVariable(name, {
				type: "assign"
			});
		}
	}
	Scope.prototype.useVariable = function(name, info) {
		if (this.used[name]) return;
		this.used[name] = info;
	}
	Scope.prototype.useGlobals = function(globals) {
		for (var name in globals) {
			if (this.declared[name] && !this.top) {
				// variable was declared and we are not in top scope
				// so we don't continue to carry it.
			} else
			if (!this.used[name]) {
				this.used[name] = globals[name];
			}
		}
	}
	Scope.prototype.finalize = function() {
		var globals = {};
		for (var name in this.used) {
			if (!this.declared[name] || this.top) {
				globals[name] = this.used[name];
			}
		}
		return globals;
	}

	function traverseForEach(nodes, scope, parent) {
		if (!nodes) return;
		nodes.forEach(function(item) {
			traverse(item, scope, parent);
		});
	}

	function traverse(node, scope, parent) {
		if (!node) return;

		node._parent = parent;

		if (topStack !== null) {
			topStack.push(node.type);
		}

//console.log("NODE", JSON.stringify(node, null, 4));
//console.log("NODE", node);

		// Nodes that create a new scope.

		if (node.type === "CallExpression") {

			if (node.callee.name) {
				scope.useVariable(node.callee.name, {
					type: "call"
				});
			}


			function parseAmdDefineSignature() {
				// See if `define()` is at the top of the module.
				if (topStack && topStack.join(":") === "Program:ExpressionStatement:CallExpression") {
					descriptor.format = "amd";
				} else {
					descriptor.format = "amd-ish";
				}
				var subScope = new Scope();
				subScope.declareVariable("arguments");
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
							subScope.declareVariable(param.name);
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
				traverse(node.arguments[node.arguments.length-1].body, subScope, node);
				scope.useGlobals(subScope.finalize());
			}

			// Look for the first `define()` if we don't already have a format established.
			if (
				!descriptor.format &&
				node.callee.type === "Identifier" &&
				node.callee.name === "define" &&
				Object.keys(descriptor.globals).length === 0
			) {
				var foundDefineFunction = false;
				// Ensure a `define()` function is not declared in an accessible scope.
				// TODO: Make this more generic.
				if (
					node._parent &&
					node._parent._parent &&
					node._parent._parent.body
				) {
					node._parent._parent.body.forEach(function(node) {
						if (
							node.type === "FunctionDeclaration" &&
							node.id.type === "Identifier" &&
							node.id.name === "define"
						) {
							foundDefineFunction = true;
						}
					});
				}
				if (!foundDefineFunction) {
					parseAmdDefineSignature();
				}
			} else
			// Look for the first `require.def()` if we don't already have a format established.
			if (
				!descriptor.format &&
				node.callee.type === "MemberExpression" &&
				node.callee.object.type === "Identifier" &&
				node.callee.object.name === "require" &&
				node.callee.property.type === "Identifier" &&
				node.callee.property.name === "def" &&
				Object.keys(descriptor.globals).length === 0
			) {
				parseAmdDefineSignature();
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
			} else {
				topStack = null;
				traverseForEach(node.arguments, scope, node);
				traverse(node.callee, scope, node);
			}
		} else
		if (
			node.type === "FunctionDeclaration" ||
			node.type === "FunctionExpression"
		) {
			if (
				node._parent.type !== "AssignmentExpression" &&
				node._parent.type !== "Property"
			) {
				if (node.id) {
					scope.declareVariable(node.id.name);
				}
			}
			var subScope = new Scope();
			subScope.declareVariable("arguments");
			if (
				node._parent.type === "AssignmentExpression" ||
				node._parent.type !== "Property"
			) {
				if (node.id) {
					subScope.declareVariable(node.id.name);
				}
			}
			node.params.forEach(function(param) {
				subScope.declareVariable(param.name);
			});
			traverse(node.body, subScope, node);
			scope.useGlobals(subScope.finalize());
		} else
		if (node.type === "CatchClause") {
			var subScope = new Scope();
			subScope.declareVariable(node.param.name);
			traverse(node.body, subScope, node);
			scope.useGlobals(subScope.finalize());
		} else

		// Nodes that test for, use or declare variables.

		if (node.type === "UnaryExpression") {
			if (
				node.operator === "typeof" &&
				node.argument.type === "Identifier"
			) {
				scope.useVariable(node.argument.name, {
					type: "typeof"
				});
			} else {
				traverse(node.argument, scope, node);
			}
		} else
		if (node.type === "VariableDeclaration") {
			traverseForEach(node.declarations, scope, node);
		} else
		if (node.type === "VariableDeclarator") {
			scope.declareVariable(node.id.name);
			traverse(node.init, scope, node);
		} else
		if (node.type === "Identifier") {
			if (node._parent.type === "AssignmentExpression" && node._parent.left === node) {
				scope.useVariable(node.name, {
					type: "assign"
				});
			} else
			if (
				(node._parent.type === "MemberExpression" && node._parent.object === node) ||
				(node._parent.type === "CallExpression" && node._parent.arguments.indexOf(node) > -1)
			) {
				scope.useVariable(node.name, {
					type: "reference"
				});
			}
		} else
		if (node.type === "MemberExpression") {
			if (
				node.object &&
				node.object.type === "Identifier" &&
				node.object.name === "require" &&
				node.property &&
				node.property.type === "Identifier" &&
				node.property.name === "main"
			) {
				descriptor.uses["require.main"] = true;
			} else
			if (
				node.object &&
				node.object.type === "Identifier" &&
				node.object.name === "require" &&
				node.property &&
				node.property.type === "Identifier" &&
				node.property.name === "resolve" &&
				node._parent.arguments &&
				node._parent.arguments.length === 1
			) {
				if (node._parent.arguments[0].type === "Literal") {
					if (!descriptor.dependencies["static"][node._parent.arguments[0].value]) {
						descriptor.dependencies["static"][node._parent.arguments[0].value] = {
							where: "resolve"
						};
					}
				} else {
					// TODO: Support dynamic resolve better (like dynamic require).
				}
			} else {
				traverse(node.object, scope, node);
			}
		} else

		// Other nodes that use existing scope.

		if (node.type === "Program") {
			traverseForEach(node.body, scope, node);
		} else
		if (node.type === "Literal") {
		} else
		if (node.type === "ThisExpression") {
		} else
		if (node.type === "ReturnStatement") {
			traverse(node.argument, scope, node);
		} else
		if (node.type === "Property") {
			traverse(node.value, scope, node);
		} else
		if (node.type === "NewExpression") {
			traverse(node.callee, scope, node);
			traverseForEach(node.body, scope, node);
		} else
		if (node.type === "ObjectExpression") {
			traverseForEach(node.properties, scope, node);
		} else
		if (node.type === "LogicalExpression") {
			traverse(node.left, scope, node);
			traverse(node.right, scope, node);
		} else
		if (node.type === "ExpressionStatement") {
			traverse(node.expression, scope, node);
		} else
		if (node.type === "TryStatement") {
			traverse(node.block, scope, node);
			traverseForEach(node.handlers, scope, node);
			traverseForEach(node.guardedHandlers, scope, node);
		} else		
		if (node.type === "AssignmentExpression") {
			traverse(node.left, scope, node);
			traverse(node.right, scope, node);
		} else
		if (node.type === "ArrayExpression") {
			traverseForEach(node.elements, scope, node);
		} else
		if (node.type === "UpdateExpression") {
		} else
		if (node.type === "SequenceExpression") {
			traverseForEach(node.expressions, scope, node);
		} else
		if (node.type === "SwitchStatement") {
			traverse(node.discriminant, scope, node);
			traverseForEach(node.cases, scope, node);
		} else
		if (node.type === "SwitchCase") {
			traverse(node.test, scope, node);
			traverseForEach(node.consequent, scope, node);
		} else
		if (node.type === "ContinueStatement") {
		} else
		if (node.type === "LabeledStatement") {
			traverse(node.body, scope, node);
		} else	
		if (node.type === "EmptyStatement") {
		} else
		if (node.type === "DoWhileStatement") {
			traverse(node.test, scope, node);
			traverse(node.body, scope, node);
		} else
		if (node.type === "BreakStatement") {
		} else
		if (node.type === "ThrowStatement") {
		} else
		if (node.type === "ForStatement") {
			traverse(node.body, scope, node);
		} else
		if (node.type === "ForInStatement") {
			traverse(node.left, scope, node);
			traverse(node.right, scope, node);
			traverse(node.body, scope, node);
		} else
		if (node.type === "BinaryExpression") {
			traverse(node.left, scope, node);
			traverse(node.right, scope, node);
		} else
		if (node.type === "ConditionalExpression") {
			traverse(node.test, scope, node);
			traverse(node.consequent, scope, node);
			traverse(node.alternate, scope, node);
		} else
		if (node.type === "IfStatement") {
			traverse(node.test, scope, node);
			traverse(node.consequent, scope, node);
			traverse(node.alternate, scope, node);
		} else
		if (node.type === "WhileStatement") {
			traverse(node.test, scope, node);
			traverse(node.body, scope, node);
		} else
		if (node.type === "WithStatement") {
			traverse(node.object, scope, node);
			traverse(node.body, scope, node);
		} else
		if (node.type === "BlockStatement") {
			traverseForEach(node.body, scope, node);
		} else {
			// TODO: Don't throw here and just stop traversing deeper
			//		 once we have all nodes that need to be traversed above.
			throw new Error("Unknown node type '" + node.type + "'");
		}
	}

	var scope = new Scope(true);

	traverse(node, scope);

	var globals = scope.finalize();
	for (var name in globals) {
		descriptor.globals[name] = globals[name];
	}
}
