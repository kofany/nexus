import {expect} from "chai";

import Chan from "../../dist/server/models/chan.js";
import Msg from "../../dist/server/models/msg.js";
import Network from "../../dist/server/models/network.js";
import Prefix from "../../dist/server/models/prefix.js";
import User from "../../dist/server/models/user.js";
describe("Chan", function () {
	const network = {
		network: {
			options: {
				PREFIX: [
					{symbol: "~", mode: "q"},
					{symbol: "&", mode: "a"},
					{symbol: "@", mode: "o"},
					{symbol: "%", mode: "h"},
					{symbol: "+", mode: "v"},
				],
			},
		},
	};

	const prefixLookup = {modeToSymbol: {}} as Prefix;

	network.network.options.PREFIX.forEach((mode) => {
		prefixLookup.modeToSymbol[mode.mode] = mode.symbol;
	});

	describe("#findMessage(id)", function () {
		const chan = new Chan({
			messages: [
				new Msg({id: 1}),
				new Msg({
					id: 2,
					text: "Message to be found",
				}),
				new Msg(),
			],
		});

		it("should find a message in the list of messages", function () {
			expect(chan.findMessage(2)?.text).to.equal("Message to be found");
		});

		it("should not find a message that does not exist", function () {
			expect(chan.findMessage(42)).to.be.undefined;
		});
	});

	describe("#setUser(user)", function () {
		it("should make key lowercase", function () {
			const chan = new Chan();
			chan.setUser(new User({nick: "TestUser"}));

			expect(chan.users.has("testuser")).to.be.true;
		});

		it("should update user object", function () {
			const chan = new Chan();
			chan.setUser(new User({nick: "TestUser"}, prefixLookup));
			chan.setUser(new User({nick: "TestUseR", modes: ["o"]}, prefixLookup));
			const user = chan.getUser("TestUSER");

			expect(user.mode).to.equal("@");
		});
	});

	describe("#getUser(nick)", function () {
		it("should returning existing object", function () {
			const chan = new Chan();
			chan.setUser(new User({nick: "TestUseR", modes: ["o"]}, prefixLookup));
			const user = chan.getUser("TestUSER");

			expect(user.mode).to.equal("@");
		});

		it("should make new User object if not found", function () {
			const chan = new Chan();
			const user = chan.getUser("very-testy-user");

			expect(user.nick).to.equal("very-testy-user");
		});
	});

	// Legacy IRC tests for getSortedUsers() removed - proxy mode uses simple sorting

	describe("#getFilteredClone(lastActiveChannel, lastMessage)", function () {
		it("should keep necessary properties", function () {
			const chan = new Chan();

			expect(chan.getFilteredClone()).to.be.an("object").that.has.all.keys(
				"firstUnread",
				"highlight",
				"id",
				"key",
				"messages",
				"muted",
				"totalMessages",
				"name",
				"state",
				"topic",
				"type",
				"unread",
				// the following are there in special cases, need to fix the types
				"num_users",
				"special",
				"closed",
				"data",
				"users" // Added for irssi mode - includes user list
			);
		});

		it("should send only last message for non active channel", function () {
			const chan = new Chan({
				id: 1337,
				messages: [
					new Msg({id: 10}),
					new Msg({id: 11}),
					new Msg({id: 12}),
					new Msg({id: 13}),
				],
			});

			expect(chan.id).to.equal(1337);

			const messages = chan.getFilteredClone(999).messages;

			expect(messages).to.have.lengthOf(1);
			expect(messages[0].id).to.equal(13);
		});

		it("should send more messages for active channel", function () {
			const chan = new Chan({
				id: 1337,
				messages: [
					new Msg({id: 10}),
					new Msg({id: 11}),
					new Msg({id: 12}),
					new Msg({id: 13}),
				],
			});

			expect(chan.id).to.equal(1337);

			const messages = chan.getFilteredClone(1337).messages;

			expect(messages).to.have.lengthOf(4);
			expect(messages[0].id).to.equal(10);
			expect(messages[3].id).to.equal(13);

			expect(chan.getFilteredClone(true).messages).to.have.lengthOf(4);
		});

		it("should only send new messages", function () {
			const chan = new Chan({
				id: 1337,
				messages: [
					new Msg({id: 10}),
					new Msg({id: 11}),
					new Msg({id: 12}),
					new Msg({id: 13}),
					new Msg({id: 14}),
					new Msg({id: 15}),
				],
			});

			expect(chan.id).to.equal(1337);

			const messages = chan.getFilteredClone(1337, 12).messages;

			expect(messages).to.have.lengthOf(3);
			expect(messages[0].id).to.equal(13);
			expect(messages[2].id).to.equal(15);
		});
	});
});
