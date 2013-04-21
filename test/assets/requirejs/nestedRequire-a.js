// @see https://github.com/jrburke/requirejs/blob/master/tests/nestedRequire/a.js
define(['base'], function (base) {
    return {
        name: 'a',
        counter: 0,
        doSomething: function () {
            this.counter += 1;
            this.base = base;
            //This should not cause double notifications.
            require(['base'], function () {
            });
        }
    };
});