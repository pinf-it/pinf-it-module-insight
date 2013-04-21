
const PATH = require("path");
const FS = require("fs-extra");
const LINTER = require("jslint/lib/linter");
const ESPRIMA = require("esprima");


exports.parseFile = function(filePath, options, callback) {
	try {

		options = options || {};

		var descriptor = {
			filename: PATH.basename(filePath),
			mtime: Math.floor(FS.statSync(filePath).mtime.getTime()/1000),
			code: FS.readFileSync(filePath).toString(),
			globals: {},
			format: null,
			undefine: [],
			warnings: [],
			errors: []
		};

		if (options.debug) console.log("Parse file:", filePath);

		var extension = filePath.match(/\.([^\.]*)$/)[1];

		if (extension === "js") {

			return parseJavaScript(descriptor, options, function(err) {
				if (err) {
					descriptor.errors.push([
						"parse", err.message, err.stack
					]);
				}
				return callback(null, descriptor);
			});

		} else
		if (extension === "php") {
			throw new Error("Parsing of PHP files is planned but not yet implemented");
		} else {
			throw new Error("Could not parse file with extension '" + extension + "'");
		}


	} catch(err) {
		return callback(err);
	}
}


function parseJavaScript(descriptor, options, callback) {
	try {

		// Determine if the code:
		//   1) Invokes globals
		//   2) Assigns globals
		//   3) Uses globals in some fashion
		// Based on this we try to determine:
		//	 1) The module wrapper used if any
		//   2) What the module imports
		//   3) What the module exports
		try {

			var syntax = ESPRIMA.parse(descriptor.code);

//console.log("SYNTAX", JSON.stringify(syntax, null, 4));

			// Find all global variables.
			// TODO: Include if globals are assigned or used only.
			descriptor.globals = findGlobals(syntax);

			if (Object.keys(descriptor.globals).length === 0) {
				descriptor.warnings.push([
					"parse", "No global variables found. Thus cannot interface with code."
				]);
			} else {

				// Determine ideal module format by looking at globals in order.
				for (var name in descriptor.globals) {
					if (name === "exports") {
						descriptor.format = "commonjs";
						break;
					} else
					if (name === "define") {
						descriptor.format = "amd-ish";

						// TODO: Use requirejs parser to see if we can narrow down
						//		 to clean `define()` format.

						break;
					}
				}

				// We should undefine all globals belonging to other formats
				// that the ideal module format is not using.
				var undefine = {
					// http://wiki.commonjs.org/wiki/Modules/1.1
					// http://nodejs.org/api/modules.html
					"commonjs": [
						"require",
						"module",
						"exports"
					],
					// https://github.com/amdjs/amdjs-api/wiki/AMD
					"amd": [
						"define"
					],
					"amd-ish": [
						"define"
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
				}
			}

			if (!descriptor.format) {
				descriptor.warnings.push([
					"parse", "Could not detect module format."
				]);
			}

		} catch(err) {
			descriptor.errors.push([
				"parse", "Error parsing syntax.", err.stack
			]);
		}

		// TODO: Lint the code to parse out other info.
		//var lint = LINTER.lint(code, {});

		return callback(null);

	} catch(err) {
		return callback(err);
	}
}


function findGlobals(node) {

	var globals = {};

	function Scope(parent) {
		this.variables = (parent && [].concat(parent.variables)) || [];
	}

	function traverseForEach(nodes, scope) {
		if (!nodes) return;
		nodes.forEach(function(item) {
			traverse(item, scope);
		});
	}

	function traverse(node, scope) {
		if (!node) return;

//console.log("NODE", JSON.stringify(node, null, 4));

		// Nodes that create a new scope.

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
				if (scope.variables.indexOf(node.argument.name) === -1) {
					globals[node.argument.name] = {
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
		} else
		if (node.type === "Identifier") {
			if (scope.variables.indexOf(node.name) === -1) {
				globals[node.name] = {
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
		} else
		if (node.type === "Property") {
		} else
		if (node.type === "NewExpression") {
			traverse(node.callee, scope);
			traverseForEach(node.body, scope);
		} else
		if (node.type === "ObjectExpression") {
			traverseForEach(node.body, scope);
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
		if (node.type === "CallExpression") {
			traverseForEach(node.arguments, scope);
			traverse(node.callee, scope);
		} else
		if (node.type === "ArrayExpression") {
			traverseForEach(node.body, scope);
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

	return globals;
}
