// @see https://github.com/jrburke/requirejs/blob/master/tests/circular/a.js
define(['b', 'exports'], function (b, exports) {
    exports.name = 'a';
    exports.b = b;
});