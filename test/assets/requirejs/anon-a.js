// @see https://github.com/jrburke/requirejs/blob/master/tests/anon/a.js
define(function (require) {
    var b =  require("sub/b");
    return {
        name: "a",
        bName: b.f()
    };
});