const JSON = require('circular-json');
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const formatMessage = require('format-message');
const RosUtil = require('./RosUtil');

const icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAADTUlEQVRIS63VTWgUZxgH8P+7Mzsf+2U2SrPJKBoEA1WKUMzupaKHpgoetadCnaBN9FRaLLRQEW17KKIed1V21dJLbU/FRqiixx219NDaVi+NmnWNZT+cze7Ozsf7yoxEYpnMRJI5DQzP+5v3P8/7DEHANVHM7iXAVyAkwQCNgZYjDp3KH7jzZ1DdwmckBLirrE29KQgcTNOBZTrQdYP2es631LSPnp34zQqDlgTIcvTlOowxNBsG6o3uHw6he899eOt+EBIGeBHxUW5ElDjEYwKSKdFbzzAsVB61/q4lWlsvv3/XXAwJBOaL9pe29slE3MgoOSHF+N0DAwnwfASNehe1WudkYVw7sixgYfFkMXtSikU/VZQU3LhmHjVZ17Sz59Tbt/2QJe3glUIGMnEhe3PgjcR2Ny5dN/Df0873ebX8gS/wshUBUMK+PKveuhzWGZPF0fdiceHq4FAK3a6FyoyuFca13GKA14ruw8qM/ldhXNscBnz03duDUSY83jCchu04ePBvs5ZXtTW+wGQpW12/IZ1xP9r0dAM9g2bOH9Rmg5DDpW0ZwvFVD7CpW1ctqNqQP1DM/ZJRErvdFqw+bqHdMccKqvZr4AEsbdsVj4lTbkTttolqtXWloGp7FtlB7uv+1fIX6bSM9pyJJ9W5a3m1PAYC5ou4H7mUvT44mNwZTwio17to1Dsn8qp21Bc4cGl0WCLcP+vW9wkRQrxddNrW6cyw9NmxnTfthUX7ftgs9LcTP8dkfmxIWeW16cOHTdO22EheLU8v2qYTxezn6bT8zeo1MS/T2dk5GB3rHgNOMd6+SsFxnE3eJcAnohwdUZQkQAjqtTYadePHwri2L/CgHbuxg3/ywPhdUZJbJOnF3GnpPS9fw7ABAkgij3h8flS46REYPRvVig5KoebV8oXAg3bw4ugmjkV+6u+Xt/T1SSDE/wy6sTxrdiHHBYgCH4q8ssqLjOPHZYk/kkiKEUHg4Y5qBgbLpDBNG62W5Rhde4rjsGdISUEUgxHf1zx0MfsWdTBGCHIAeQeABbAyBdPmfziTpdz+SASlMOT1Z9GCoJeCLAtwrTBk2UAYsiKAH+JN2YreXDHg/wilzJ3Oz1YUmEcYY2fce0LIx88BFi6vvp70RPYAAAAASUVORK5CYII=";

class Scratch3RosBlocks {

    constructor(runtime) {
        // Can only establish safe connections to localhost when running from github.io
        this.ros = new RosUtil({ url : 'ws://localhost:9090' });
        this.topicNames = ['topic'];
        this.serviceNames = ['service'];
        this.runtime = runtime;
    };

    makeMessage({TOPIC}) {
        var ROS = this.ros;
        return new Promise( function(resolve) {
            ROS.getMessageDetailsByTopic(TOPIC).then( function(result) {
                var example = ROS.messageExample(result[0], result);
                example.toString = function() { return JSON.stringify(this); }
                resolve(example); });
        });
    };

    makeRequest({SERVICE}) {
        var ROS = this.ros;
        return new Promise( function(resolve) {
            ROS.getRequestDetailsByService(SERVICE).then( function(result) {
                var example = ROS.messageExample(result[0], result);
                example.toString = function() { return JSON.stringify(this); }
                resolve(example); });
        });
    };

    subscribeTopic({TOPIC}) {
        var ROS = this.ros;
        return new Promise( function(resolve) {
            ROS.getTopic(TOPIC).then(
                rosTopic =>
                    rosTopic.subscribe(msg => { rosTopic.unsubscribe();
                                                msg.toString = function() { return JSON.stringify(this); }
                                                resolve(msg); }));
        });
    };

    publishTopic({MSG, TOPIC}, util) {
        var msg = this._getVariableValue(MSG) || this._tryParse(MSG);

        this.ros.getTopic(TOPIC).then(
            rosTopic => rosTopic.publish(msg));
    };

    callService({REQUEST, SERVICE}, util) {
        var req = this._getVariableValue(REQUEST) || this._tryParse(REQUEST);

        var ROS = this.ros;
        return new Promise( function(resolve) {
            ROS.getService(SERVICE).then(
                rosService => rosService.callService(req,
                                                     res => { rosService.unadvertise();
                                                              resolve(res); }));
        });
    };

    getSlot({OBJECT, SLOT}, util) {
        const variable = util.target.lookupVariableByNameAndType(OBJECT);
        var obj = variable && variable.value || this._tryParse(OBJECT);
        var res = obj && eval('obj' + '.' + SLOT);
        if (util.thread.updateMonitor) {
            if (res) return JSON.stringify(res);
            else {
                var name = OBJECT + '.' + SLOT;
                var id = variable ?
                    variable.id + name :
                    Object.keys(util.runtime.monitorBlocks._blocks).
                    find(key => key.search(name) >= 0);

                util.runtime.monitorBlocks.deleteBlock(id);
                util.runtime.requestRemoveMonitor(id);
            }
        }
        if (typeof(res) === 'object')
            res.toString = function() { return JSON.stringify(this); }
        return res;
    };

    setSlot({VAR, SLOT, VALUE}, util) {
        function setNestedValue(obj, slots, value) {
            var last = slots.length - 1;
            for(var i = 0; i < last; i++)
                obj = obj[ slots[i] ] = obj[ slots[i] ] || {};

            obj = obj[slots[last]] = value;
        };

        const variable = util.target.lookupVariableByNameAndType(VAR);
        if (!variable) return;

        if (typeof(variable.value) === 'object')
            // Clone object to avoid overwriting parent variables
            variable.value = JSON.parse(JSON.stringify(variable.value));
        else
            variable.value = {};
        var slt = SLOT.split('.');
        var val = Array.isArray(VALUE) ?
            VALUE.map(v => this._tryParse(v,v)) :
            this._tryParse(VALUE, VALUE);

        setNestedValue(variable.value, slt, val);

        // TODO: cloud variables
    };

    showVariable(args) { this._changeVariableVisibility(args, true); };

    hideVariable(args) { this._changeVariableVisibility(args, false); };

    _getVariableValue(name, type) {
        var target = this.runtime.getEditingTarget();
        var variable = target.lookupVariableByNameAndType(name, type);
        return variable && variable.value;
    };

    _tryParse(value, reject) {
        try {
            return JSON.parse(value);
        } catch(err) { return reject; }
    };

    _changeVariableVisibility({OBJECT, SLOT}, visible) {
        const target = this.runtime.getEditingTarget();
        const variable = target.lookupVariableByNameAndType(OBJECT);
        const id = variable && variable.id + OBJECT + '.' + SLOT;
        if (!id) return;

        if (visible && !(this.runtime.monitorBlocks._blocks[id])) {
            var isLocal = !(this.runtime.getTargetForStage().variables[variable.id]);
            var targetId = isLocal ? target.id : null;
            this.runtime.monitorBlocks.createBlock(
                {id: id,
                 targetId: targetId,
                 opcode: 'ros_getSlot',
                 fields: {OBJECT: {value: OBJECT}, SLOT: {value: SLOT}}
                });
        }

        this.runtime.monitorBlocks.changeBlock({
            id: id,
            element: 'checkbox',
            value: visible
        }, this.runtime);
    };

    _updateTopicList() {
        var that = this;
        that.ros.getTopics( function(topics){
            that.topicNames = topics.topics.sort(); });

        return that.topicNames.map(function(val) { return {value: val, text: val}; });
    };

    _updateServiceList() {
        var that = this;
        that.ros.getServices( function(services){
            that.serviceNames = services.sort(); });
        return that.serviceNames.map(function(val) { return {value: val, text: val}; });
    };

    _updateVariablesList() {
        try {
            var varlist = this.runtime.getEditingTarget().getAllVariableNamesInScopeByType();
        } catch(err) { return [{value: 'my variable', text: 'my variable'}] }

        if (varlist.length == 0)
            return [{value: 'my variable', text: 'my variable'}];
        else
            return varlist.map(function(val) {return {value: val, text: val}; });
    };

    getInfo() {
        return {
            id: 'ros',
            name: 'ROS',

            colour: '#8BC34A',
            colourSecondary: '#7CB342',
            colourTertiary: '#689F38',

            menuIconURI: icon,

            blocks: [
                {
                    opcode: 'subscribeTopic',
                    blockType: BlockType.REPORTER,
                    text: 'Get message from [TOPIC]',
                    arguments: {
                        TOPIC: {
                            type: ArgumentType.STRING,
                            menu: 'topicsMenu',
                            defaultValue: this.topicNames[0]
                        }
                    }
                },
                {
                    opcode: 'makeMessage',
                    blockType: BlockType.REPORTER,
                    text: 'Create message for [TOPIC]',
                    arguments: {
                        TOPIC: {
                            type: ArgumentType.STRING,
                            menu: 'topicsMenu',
                            defaultValue: this.topicNames[0]
                        }
                    }
                },
                {
                    opcode: 'publishTopic',
                    blockType: BlockType.COMMAND,
                    text: 'Publish [MSG] to [TOPIC]',
                    arguments: {
                        MSG: {
                            type: ArgumentType.STRING,
                            menu: 'variablesMenu',
                            defaultValue: this._updateVariablesList()[0].text
                        },
                        TOPIC: {
                            type: ArgumentType.STRING,
                            menu: 'topicsMenu',
                            defaultValue: this.topicNames[0]
                        }
                    }
                },
                {
                    opcode: 'makeRequest',
                    blockType: BlockType.REPORTER,
                    text: 'Create request for [SERVICE]',
                    arguments: {
                        SERVICE: {
                            type: ArgumentType.STRING,
                            menu: 'servicesMenu',
                            defaultValue: this.serviceNames[0]
                        }
                    }
                },
                {
                    opcode: 'callService',
                    blockType: BlockType.REPORTER,
                    text: 'Send [REQUEST] to [SERVICE]',
                    arguments: {
                        REQUEST: {
                            type: ArgumentType.STRING,
                            menu: 'variablesMenu',
                            defaultValue: this._updateVariablesList()[0].text
                        },
                        SERVICE: {
                            type: ArgumentType.STRING,
                            menu: 'servicesMenu',
                            defaultValue: this.serviceNames[0]
                        }
                    }
                },
                {
                    opcode: 'getSlot',
                    blockType: BlockType.REPORTER,
                    text: 'Get [OBJECT] [SLOT]',
                    arguments: {
                        OBJECT: {
                            type: ArgumentType.STRING,
                            menu: 'variablesMenu',
                            defaultValue: this._updateVariablesList()[0].text
                        },
                            SLOT: {
                                type: ArgumentType.STRING,
                                defaultValue: 'data'
                            }
                    }
                },
                {
                    opcode: 'setSlot',
                    blockType: BlockType.COMMAND,
                    text: 'Set [VAR] [SLOT] to [VALUE]',
                    arguments: {
                        VAR: {
                            type: ArgumentType.STRING,
                            menu: 'variablesMenu',
                            defaultValue: this._updateVariablesList()[0].text
                        },
                            SLOT: {
                                type: ArgumentType.STRING,
                                defaultValue: 'data'
                            },
                            VALUE: {
                                type: ArgumentType.STRING,
                                defaultValue: 'Hello!'
                            }
                    }
                },
                {
                    opcode: 'showVariable',
                    blockType: BlockType.COMMAND,
                    text: 'Show [OBJECT] [SLOT]',
                    arguments: {
                        OBJECT: {
                            type: ArgumentType.STRING,
                            menu: 'variablesMenu',
                            defaultValue: this._updateVariablesList()[0].text
                        },
                            SLOT: {
                                type: ArgumentType.STRING,
                                defaultValue: 'data'
                            },
                    }
                },
                {
                    opcode: 'hideVariable',
                    blockType: BlockType.COMMAND,
                    text: 'Hide [OBJECT] [SLOT]',
                    arguments: {
                        OBJECT: {
                            type: ArgumentType.STRING,
                            menu: 'variablesMenu',
                            defaultValue: this._updateVariablesList()[0].text
                        },
                        SLOT: {
                            type: ArgumentType.STRING,
                            defaultValue: 'data'
                        },
                    }
                }
            ],
            menus: {
                topicsMenu: '_updateTopicList',
                servicesMenu: '_updateServiceList',
                variablesMenu: '_updateVariablesList'
            }
        }
    }
}

module.exports = Scratch3RosBlocks;